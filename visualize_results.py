import torch
import numpy as np
import matplotlib.pyplot as plt
from PIL import Image
import os
import sys

# Add 'src' to path to find the dataset and model definitions
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

from src.dataset import MedicalLandmarkDataset
from src.train_landmark_regression import MultiTaskResNet

def visualize_inference(num_samples=4):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # 1. Load Dataset in test mode to use unseen images
    dataset = MedicalLandmarkDataset(mode='test')
    stats = dataset.stats 
    
    # 2. Load the Multi-Task Model from the correct path
    model = MultiTaskResNet(num_classes=4).to(device)
    model_path = 'logs/best_multitask_model.pth'
    
    if not os.path.exists(model_path):
        print(f"Error: Model file not found at {model_path}. Please check your 'logs' folder.")
        return

    # Load weights with weights_only=True for safety
    model.load_state_dict(torch.load(model_path, weights_only=True))
    model.eval()

    landmark_names = {0: "T1", 1: "L-Shoulder", 2: "R-Shoulder", 3: "Pelvis"}

    fig, axes = plt.subplots(1, num_samples, figsize=(20, 6))
    if num_samples == 1: axes = [axes]

    print(f"Inference active. Visualizing {num_samples} test samples...")

    with torch.no_grad():
        for i in range(num_samples):
            # Selection of a random test index
            idx = np.random.randint(len(dataset))
            img_tensor, label, coords = dataset[idx]
            
            # Model prediction
            input_batch = img_tensor.unsqueeze(0).to(device)
            out_cls, out_reg = model(input_batch)
            
            # Result extraction
            _, pred_class = torch.max(out_cls, 1)
            pred_coords = out_reg.cpu().numpy()[0]
            true_coords = coords.numpy()

            # Denormalization for spatial error calculation in mm
            p_x = pred_coords[0] * stats['x_std'] + stats['x_mean']
            t_x = true_coords[0] * stats['x_std'] + stats['x_mean']
            p_y = pred_coords[1] * stats['y_std'] + stats['y_mean']
            t_y = true_coords[1] * stats['y_std'] + stats['y_mean']
            p_z = pred_coords[2] * stats['z_std'] + stats['z_mean']
            t_z = true_coords[2] * stats['z_std'] + stats['z_mean']
            
            error_mm = np.sqrt((p_x-t_x)**2 + (p_y-t_y)**2 + (p_z-t_z)**2)
            
            # Image preparation (Un-normalization)
            display_img = img_tensor.permute(1, 2, 0).numpy()
            display_img = (display_img * np.array([0.229, 0.224, 0.225])) + np.array([0.485, 0.456, 0.406])
            display_img = np.clip(display_img, 0, 1)

            axes[i].imshow(display_img)
            
            # Formatting the display text
            target_txt = landmark_names[label.item()]
            pred_txt = landmark_names[pred_class.item()]
            color = 'lime' if target_txt == pred_txt else 'red'
            
            axes[i].set_title(f"ID: {pred_txt}", color=color, fontsize=14, fontweight='bold')
            axes[i].text(10, 30, f"Target: {target_txt}", color='white', backgroundcolor='black')
            axes[i].text(10, 210, f"Error: {error_mm:.1f}mm", color='yellow', fontweight='bold', backgroundcolor='black')
            axes[i].axis('off')

    plt.tight_layout()
    plt.savefig('conference_results_visual.png', dpi=300)
    print("Visual results saved as 'conference_results_visual.png'.")
    plt.show()

if __name__ == "__main__":
    visualize_inference(num_samples=4)