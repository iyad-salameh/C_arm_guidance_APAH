import os
import torch
import pandas as pd
import numpy as np
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms

class MedicalLandmarkDataset(Dataset):
    def __init__(self, mode='train', size=(224, 224)):
        self.df = pd.read_csv('data/annotations_v2.csv')
        self.df = self.df[self.df['mode'] == mode].reset_index(drop=True)
        self.size = size
        
        # Calculate normalization constants
        self.stats = {
            'x_mean': self.df['x'].mean(), 'x_std': self.df['x'].std(),
            'y_mean': self.df['y'].mean(), 'y_std': self.df['y'].std(),
            'z_mean': self.df['z'].mean(), 'z_std': self.df['z'].std()
        }
        
        self.transform = transforms.Compose([
            transforms.Resize(self.size),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        
        # 1. Load Image (Ensure path matches your system)
        img_path = row['filename'].replace('\\', '/')
        image = Image.open(img_path).convert('RGB')
        image = self.transform(image)
        
        # 2. Label (0-3 for Classification)
        label = torch.tensor(row['landmark_id'] - 1, dtype=torch.long)
        
        # 3. Normalized Coordinates (Regression)
        x = (row['x'] - self.stats['x_mean']) / self.stats['x_std']
        y = (row['y'] - self.stats['y_mean']) / self.stats['y_std']
        z = (row['z'] - self.stats['z_mean']) / self.stats['z_std']
        coords = torch.tensor([x, y, z], dtype=torch.float32)
        
        return image, label, coords