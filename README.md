**part1:**

Autonomous Surgical C-arm GuidanceMulti-Modal Spatial Fusion of Synthetic Fluoroscopy and 3D Depth Sensing

📌Project Overview
Manual positioning of C-arm fluoroscopy systems in orthopedic and spinal surgeries is a time-intensive process that leads to excessive radiation exposure and sub-optimal landmark alignment.

This project addresses these challenges by fusing Deep Learning-based landmark regression with real-time 3D physical data.
The system utilizes a dual-task ResNet-34 architecture trained on high-fidelity synthetic fluoroscopy data to identify internal landmarks.
To bridge the gap between 2D imagery and 3D surgical space, we integrate an Intel RealSense D435 depth camera and its Inertial Measurement Unit (IMU) to provide precise XYZ coordinates and orientation data.

🚀 Key FeaturesSynthetic-to-Real Pipeline: Overcomes medical data scarcity by generating 2K resolution synthetic fluoroscopy images using SDXL (Nano Banana Pro).Multi-Task Neural Network: Concurrent anatomical classification (100% accuracy) and 3D coordinate regression.Sensor Fusion: Combines AI-predicted "internal" landmarks with RealSense "external" depth and IMU data to resolve spatial ambiguity.Edge-Ready Architecture: Designed for deployment on Raspberry Pi 5 / Jetson Nano for real-time robotic gantry control.

📂 Repository StructurePlaintext.
├── data/                       # Synthetic Dataset (Anatomical Landmarks)
├── src/                        # Core Source Code
│   ├── dataset.py              # PyTorch Dataset & Normalization logic
│   └── train_landmark_regression.py # ResNet34 Multi-Task training loop
├── logs/                       # Trained Weights (*.pth files)
├── evaluate_final.py           # Metric calculation (Accuracy & Error in mm)
├── visualize_results.py        # Inference visualizer with denormalization
├── annotations_v2.csv          # Ground truth labels for training
└── README.md                   # Project Documentation

🛠 Technical Implementation
1. Data Generation StrategyTo ensure a clean, medical-grade dataset, we utilize a refined prompting strategy that focuses on Direct Digital Radiography (DR) to eliminate common artifacts like monitor bezels and hospital room backgrounds.Anatomical Targets: T1 Vertebra, Left/Right Humeral Head, and Pelvis.Dataset Balance: 15 high-fidelity images per class to ensure zero bias in lateral (Left/Right) identification.
2. Multi-Task ArchitectureThe system employs a shared ResNet-34 backbone  branching into two specialized heads:Classification Head: Identifies which anatomical region is present.Regression Head: Predicts the $(x, y, z)$ coordinates within that space.
3. Spatial Correction LogicThe core innovation is using Inertial Measurement (IMU) and Depth Sensing to correct the 95mm residual error found in image-only models.AI: Provides the "Anatomical Anchor."IMU: Provides the "Gantry Orientation."Depth: Provides the "Physical Ground Truth."📊 Performance BenchmarksMetricResult (150 Epochs)Anatomical ID Accuracy100.0%Mean Spatial Error (AI Only)95.42 mmBest Case Precision50.34 mm💻 Getting StartedPrerequisitesPython 3.10+PyTorch & TorchvisionIntel RealSense SDK (librealsense)CUDA-capable GPU (Recommended for training)InstallationBashgit clone https://github.com/your-username/C_arm_guidance_APAH.git
cd C_arm_guidance_APAH
pip install -r requirements.txt

UsageTraining the model:Bashpython src/train_landmark_regression.py
Evaluating Accuracy (mm):Bashpython evaluate_final.py
Visualizing Inference:Bashpython visualize_results.py
🔮 Future WorkSub-millimeter Registration: Implementing ArUco markers for precise camera-to-table calibration.Robotic Closed-Loop: Connecting the Raspberry Pi 5 output to motorized C-arm gantry actuators.Uncertainty Calibration: Integrating Monte Carlo Dropout to quantify AI confidence levels during surgery.



**Part 2:**
🩻 C-Arm Guidance & Fluoroscopy Simulator
Physically-Based Beam Geometry + Landmark-Driven X-ray Rendering
📌 Overview

This project is a real-time 3D C-arm simulator built with:

React

Three.js

Procedural kinematic modeling

Physics-based beam computation

The system simulates:

Robotic C-arm positioning

Real beam geometry (Source → Detector)

Ray–patient intersection

Landmark-based anatomical targeting

Fluoroscopy live view with realistic X-ray rendering

The current version uses pre-generated realistic X-ray images mapped to anatomical landmarks.

🏗 System Architecture
1️⃣ 3D Scene

The scene contains:

Procedural robotic C-arm

Static patient GLB model (no skeleton rig)

X-ray source anchor

Detector anchor

Beam frustum

Debug physics overlays

The patient remains fixed in canonical horizontal supine orientation.

2️⃣ Beam Physics Model

Every animation frame:

Get world position of:

Source anchor

Detector anchor

Compute:

Beam direction vector

SID (Source-Image Distance)

Beam frustum orientation

Perform:

Ray–patient volume intersection

If intersection exists:

Compute beam center inside patient

Transform hit point to patient-local coordinates

3️⃣ Landmark-Based Targeting

Instead of heuristic torso corridors or OBB classification,
the system now uses explicit anatomical landmarks.

Why this is better:

Deterministic

Anatomically grounded

No voting heuristics

No corridor approximations

Works reliably for all poses (patient is static)

🧍 Anatomical Landmark System

We define 17 canonical landmarks, corresponding to:

ID	Landmark
0	Head
1	Neck
2	Right Knee
3	Right Foot
4	Right Hip
5	Left Knee
6	Left Foot
7	Left Hip
8	Thorax
9	Abdomen
10	Pelvis
11	Left Shoulder
12	Right Shoulder
13	Left Hand
14	Left Elbow
15	Right Elbow
16	Right Hand

Each landmark is defined as:

{
  key: "leftHand",
  label: "LEFT HAND",
  localPosition: new THREE.Vector3(x, y, z)
}


These coordinates are defined in patient local space.

🎯 Beam → Landmark Selection

When the beam hits the patient:

Compute beam center inside the body.

Convert that point to patient-local coordinates.

Compute distance to each landmark:

distance = localHitPoint.distanceTo(landmark.localPosition)


Select:

closestLandmark = minimum(distance)


Store:

beamZoneKeyRef.current = closestLandmark.key


This becomes the single source of truth for:

UI display

X-ray generation

Debug readout

Downloaded image

🖼 X-ray Rendering System

Instead of procedural SVG bones,
we now use pre-generated realistic X-ray images.

Directory Structure
public/xrays/
    head.png
    neck.png
    thorax.png
    abdomen.png
    pelvis.png
    leftHand.png
    rightHand.png
    leftKnee.png
    rightKnee.png
    ...

Image Retrieval

When handleTakeXray() is called:

const landmarkKey = beamZoneKeyRef.current;

const imageUrl = `/xrays/${landmarkKey}.png`;
setLastXray(imageUrl);


No API calls.
No latency.
Fully deterministic.

🧠 Why This Is Architecturally Strong
✔ Physically Correct Beam

The beam is aligned from source to detector using quaternion rotation.

✔ Anatomically Deterministic

We no longer guess zones.
We compute true nearest anatomical target.

✔ Stable Under Edge Cases

No:

Limb corridor confusion

Torso voting artifacts

Weird pose mislabeling

✔ Modular

You can later swap:

imageUrl


with:

DeepDRR

Replicate API

GAN inference

DiffDRR

Local PyTorch model

Anything

The architecture is ready.

🧪 Debug Mode

Press D to toggle.

Shows:

Source coordinates

Detector coordinates

SID

Beam angle error

Intersection distances

Selected landmark

Hit status

This allows full geometric verification.

🎛 Controls
Control	Meaning
Cart Long	Longitudinal translation
Cart Lat	Lateral translation
Lift	Vertical height
Column Rot	Column rotation
Wig Wag	Side tilt
Orbital	C-arm rotation

While exposing:

Controls are locked

Beam glows

"RADIATION ON" indicator appears

📦 Current Feature Set

✔ Procedural C-arm
✔ Real beam physics
✔ Ray–OBB intersection
✔ Landmark nearest-point targeting
✔ 17 anatomical regions
✔ Realistic X-ray rendering
✔ PNG download
✔ Debug geometry overlays
✔ Deterministic behavior

🔮 Future Roadmap

Multi-landmark beam blending

True projection-based X-ray (ray sampling)

Soft tissue simulation

Scatter noise modeling

Collimation controls

Dynamic patient repositioning

DICOM metadata overlay
