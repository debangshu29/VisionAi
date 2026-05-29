import glob
import os

def fix_labels():
    count = 0
    for file_path in glob.glob('d:/django/vision/dataset_fresh/labels/**/*augV2*.txt', recursive=True):
        with open(file_path, 'r') as f:
            lines = f.readlines()
        
        new_lines = []
        for line in lines:
            parts = line.strip().split()
            if len(parts) == 5:
                cid = int(float(parts[0]))
                new_lines.append(f"{cid} {' '.join(parts[1:])}\n")
                
        with open(file_path, 'w') as f:
            f.writelines(new_lines)
        count += 1
        
    print(f"Fixed {count} files.")

if __name__ == '__main__':
    fix_labels()
