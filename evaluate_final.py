import sys
import os

# Add the 'src' directory to the python path so it can find dataset.py
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

import torch
import numpy as np
import pandas as pd
from torch.utils.data import DataLoader
from src.dataset import MedicalLandmarkDataset
from src.train_landmark_regression import MultiTaskResNet

def run_test():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # 1. Load Data
    test_set = MedicalLandmarkDataset(mode='test')
    loader = DataLoader(test_set, batch_size=1)
    stats = test_set.stats
    
    # 2. Load the "Brain"
    model = MultiTaskResNet(num_classes=4).to(device)
    
    # Ensure the path to the model is correct
    model_path = os.path.join('logs', 'best_multitask_model.pth')
    if not os.path.exists(model_path):
        print(f"Error: Could not find model at {model_path}")
        return

    model.load_state_dict(torch.load(model_path))
    model.eval()
    
    results = []
    correct_part = 0

    print(f"Testing on {len(test_set)} unseen images...")

    with torch.no_grad():
        for imgs, labels, coords in loader:
            imgs, labels, coords = imgs.to(device), labels.to(device), coords.to(device)
            out_cls, out_reg = model(imgs)
            
            # Check if part identification was correct
            _, pred_id = torch.max(out_cls, 1)
            if pred_id == labels:
                correct_part += 1
                
            # Convert normalized prediction back to Millimeters (mm)
            p = out_reg.cpu().numpy()[0]
            t = coords.cpu().numpy()[0]
            
            # We use the stats from the dataset to denormalize
            err_x = abs(p[0] - t[0]) * stats['x_std']
            err_y = abs(p[1] - t[1]) * stats['y_std']
            err_z = abs(p[2] - t[2]) * stats['z_std']
            
            dist_mm = np.sqrt(err_x**2 + err_y**2 + err_z**2)
            results.append(dist_mm)

    accuracy = (correct_part / len(test_set)) * 100
    avg_error = np.mean(results)
    
    print(f"\n--- CONFERENCE RESULTS ---")
    print(f"Anatomical ID Accuracy: {accuracy:.1f}%")
    print(f"Mean Spatial Error: {avg_error:.2f} mm")
    print(f"Best Case Precision: {np.min(results):.2f} mm")
    print(f"--------------------------")

if __name__ == "__main__":
    run_test()