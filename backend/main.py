from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from google import genai
from google.genai import types
import json
import random
import os
import io
from PIL import Image
from ultralytics import YOLO

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = YOLO("yolov8n.pt")

# --- SIMULATED RAG KNOWLEDGE BASE ---
FLIGHT_RULES_KNOWLEDGE_BASE = {
    "POWER_ANOMALY": "NASA-STD-8739.4 Sect 6.1 (Electrical Interconnects): In the event of a sudden 0.0A solar current reading during a Sunlit orbital phase with concurrent battery temperature spikes (>40°C), assume a catastrophic shunt failure or Micrometeoroid Orbital Debris (MMOD) array sever. Immediate action: Isolate the affected array physically and switch to secondary bus to prevent thermal runaway.",
    "ATTITUDE_ANOMALY": "ECSS-E-ST-60-10C Sect 5.3 (Control Performance): Gyro drift rates exceeding 1.0 deg/s indicate an imminent Loss of Attitude Control (LOAC) and potential tumbling. Immediate action: Disable primary reaction wheels, null rates using magnetic torquers, and initiate safe-hold sun-pointing mode.",
    "GENERAL": "NASA-STD-1006 Sect 4 (Space System Protection): For unclassified anomalies, maintain current attitude, isolate non-essential payloads to conserve power, and await ground-in-the-loop diagnostic."
}

# --- TELEMETRY STATE MACHINE ---
class TelemetryState:
    def __init__(self):
        self.scenario = "NOMINAL"
        self.manual_data = None
        self.uplink_status = "AOS" 
        
    def get_current_state(self):
        data = {
            "EPS_Bus_Voltage_V": round(random.uniform(27.8, 28.2), 2),
            "EPS_Solar_Current_A": round(random.uniform(14.0, 15.0), 2),
            "EPS_Battery_Temp_C": round(random.uniform(10.0, 15.0), 2),
            "AOCS_Gyro_Drift_deg_s": round(random.uniform(0.01, 0.03), 3),
            "Orbital_Status": "Sunlit",
            "Uplink_Status": self.uplink_status
        }

        if self.scenario == "MANUAL" and self.manual_data:
            data.update(self.manual_data)
            return data

        if self.scenario == "ECLIPSE_ANOMALY":
            data["EPS_Solar_Current_A"] = 0.0
            data["EPS_Battery_Temp_C"] = round(random.uniform(45.0, 50.0), 2)
            data["EPS_Bus_Voltage_V"] = round(random.uniform(23.0, 24.5), 2)
        elif self.scenario == "AOCS_FAILURE":
            data["AOCS_Gyro_Drift_deg_s"] = round(random.uniform(1.5, 2.5), 3)
            
        return data

state = TelemetryState()

# --- API ENDPOINTS ---
class ScenarioRequest(BaseModel):
    scenario: str

class ManualTelemetryRequest(BaseModel):
    EPS_Bus_Voltage_V: float
    EPS_Solar_Current_A: float
    EPS_Battery_Temp_C: float
    AOCS_Gyro_Drift_deg_s: float
    Orbital_Status: str

class UplinkRequest(BaseModel):
    status: str

@app.get("/api/telemetry")
def get_telemetry():
    return state.get_current_state()

@app.post("/api/scenario")
def set_scenario(req: ScenarioRequest):
    state.scenario = req.scenario
    return {"status": "success", "scenario": state.scenario}

@app.post("/api/manual-override")
def set_manual_override(req: ManualTelemetryRequest):
    state.scenario = "MANUAL"
    state.manual_data = req.dict()
    return {"status": "success", "mode": "MANUAL"}

@app.post("/api/uplink")
def set_uplink(req: UplinkRequest):
    state.uplink_status = req.status
    return {"status": "success", "uplink": state.uplink_status}

@app.post("/api/diagnose")
def run_diagnostic():
    current_data = state.get_current_state()
    
    if not os.environ.get("GEMINI_API_KEY"):
        return {
            "Fault_Name": "Local Fallback: API Key Missing",
            "Cited_Standard": "SYSTEM ERROR",
            "Correlated_Evidence": "Unable to reach Gemini API. Please set GEMINI_API_KEY.",
            "Hardware_Execution_Command": "export GEMINI_API_KEY='your_key'"
        }

    # RAG Retrieval Logic
    retrieved_context = FLIGHT_RULES_KNOWLEDGE_BASE["GENERAL"]
    if current_data["EPS_Solar_Current_A"] == 0.0 and current_data["Orbital_Status"] == "Sunlit":
        retrieved_context = FLIGHT_RULES_KNOWLEDGE_BASE["POWER_ANOMALY"]
    elif current_data["AOCS_Gyro_Drift_deg_s"] > 1.0:
        retrieved_context = FLIGHT_RULES_KNOWLEDGE_BASE["ATTITUDE_ANOMALY"]

    client = genai.Client()
    
    prompt = f"""
    You are an automated spacecraft diagnostic co-pilot. 
    CURRENT UPLINK STATUS: {current_data['Uplink_Status']}
    
    CRITICAL INSTRUCTION: You MUST base your diagnosis on the following retrieved aerospace standard:
    "{retrieved_context}"
    
    Analyze the provided JSON telemetry for cross-variable contradictions.
    Return a raw JSON object with exactly FOUR keys:
    1. "Fault_Name": Short title of the anomaly.
    2. "Cited_Standard": State the exact NASA or ECSS document name and section retrieved above.
    3. "Correlated_Evidence": Explain why the telemetry fails, referencing the cited standard.
    4. "Hardware_Execution_Command": Provide a single executable bash command to mitigate the issue. 
       - IF UPLINK STATUS is 'LOS', prefix the command with '[AUTO-EXECUTE LOGGED]'.
       - IF UPLINK STATUS is 'AOS', prefix the command with '[AWAITING GROUND APPROVAL]'.
    """
    
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=json.dumps(current_data),
        config=types.GenerateContentConfig(
            system_instruction=prompt,
            response_mime_type="application/json",
        )
    )
    
    return json.loads(response.text)

# --- HYBRID AI VISION ENDPOINT ---
@app.post("/api/detect-debris")
async def detect_debris(file: UploadFile = File(...)):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    img_w, img_h = image.width, image.height
    
    detections = []
    
    yolo_results = model(image)
    for box in yolo_results[0].boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        conf = float(box.conf[0])
        class_name = model.names[int(box.cls[0])].upper()
        
        detections.append({
            "source": "YOLO",
            "label": f"YOLO: {class_name}",
            "bbox": [(x1/img_w)*100, (y1/img_h)*100, (x2/img_w)*100, (y2/img_h)*100],
            "confidence": round(conf, 2)
        })

    client = genai.Client()
    prompt = """
    Analyze this orbital optical feed. Detect all space debris, satellites, or unidentified orbital objects.
    Return a JSON array where each entry contains exactly three keys:
    1. "label": A short, highly technical description of the object.
    2. "box_2d": An array of four integers [y_min, x_min, y_max, x_max] representing the 2D bounding box (normalized 0 to 1000).
    3. "confidence": A float between 0.85 and 0.99.
    If no objects are found, return an empty array [].
    """
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt, image],
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        ai_results = json.loads(response.text)
        
        for obj in ai_results:
            y_min, x_min, y_max, x_max = obj.get("box_2d", [0,0,0,0])
            label = obj.get("label", "Unknown Orbital Artifact")
            
            detections.append({
                "source": "Gemini",
                "label": f"GEMINI: {label.upper()}",
                "bbox": [(x_min/1000)*100, (y_min/1000)*100, (x_max/1000)*100, (y_max/1000)*100],
                "confidence": round(obj.get("confidence", 0.9), 2)
            })
    except Exception as e:
        print("Gemini Vision Error:", e)

    collision_warning = False
    evasion_command = "NOMINAL_TRAJECTORY: NO MANEUVER REQUIRED"
    highest_risk = 0.0

    for det in detections:
        w_pct = det["bbox"][2] - det["bbox"][0]
        h_pct = det["bbox"][3] - det["bbox"][1]
        relative_size = (w_pct * h_pct) / 10000.0 
        
        distance_km = max(1.0, 500.0 - (relative_size * 5000.0))
        velocity_kmps = 7.5 + (relative_size * 10.0)
        time_to_impact_sec = distance_km / velocity_kmps
        collision_probability = min(0.99, (1.0 / (distance_km + 0.1)) * 10.0)

        is_critical = collision_probability > 0.4

        if is_critical:
            collision_warning = True
            if collision_probability > highest_risk:
                highest_risk = collision_probability
                center_x_pct = (det["bbox"][0] + det["bbox"][2]) / 2.0
                direction = "PORT (-Y)" if center_x_pct > 50 else "STARBOARD (+Y)"
                prefix = "[AUTO-EXECUTE]" if state.uplink_status == "LOS" else "[AWAITING GROUND APPROVAL]"
                evasion_command = f"{prefix} AOCS_THRUST_{direction} 1500ms // EVADING: {det['label']}"

        det["estimated_distance_km"] = round(distance_km, 2)
        det["time_to_impact_s"] = round(time_to_impact_sec, 2)
        det["critical"] = is_critical

    return JSONResponse(content={
        "status": "ANALYSIS_COMPLETE",
        "objects_detected": len(detections),
        "collision_warning": collision_warning,
        "recommended_maneuver": evasion_command,
        "conjunction_data": detections
    })