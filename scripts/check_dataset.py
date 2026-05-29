import os
from pathlib import Path

def check_dataset_integrity(base_path):
    splits = ["train", "val", "test"]
    for split in splits:
        img_dir = Path(base_path) / "images" / split
        lab_dir = Path(base_path) / "labels" / split
        
        if not img_dir.exists() or not lab_dir.exists():
            print(f"Error: Directory for {split} split missing.")
            continue
            
        imgs = list(img_dir.glob("*.jpg"))
        labs = list(lab_dir.glob("*.txt"))
        
        print(f"Split [{split}]: {len(imgs)} images, {len(labs)} labels.")
        
        if len(imgs) != len(labs):
            print(f"  Warning: Mismatch in {split} split! {len(imgs)} vs {len(labs)}")
            
            # Find missing
            img_stems = {f.stem for f in imgs}
            lab_stems = {f.stem for f in labs}
            
            missing_labs = img_stems - lab_stems
            if missing_labs:
                print(f"  Missing labels for: {list(missing_labs)[:5]}...")
                
            missing_imgs = lab_stems - img_stems
            if missing_imgs:
                print(f"  Missing images for: {list(missing_imgs)[:5]}...")

if __name__ == "__main__":
    check_dataset_integrity(str(Path(__file__).resolve().parent.parent / "dataset/combined_training"))
