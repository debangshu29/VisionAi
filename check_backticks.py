bt = chr(96)
content = open(r'D:\django\vision\vision_app\app\(tabs)\outdoor.tsx', encoding='utf-8').read()
lines = content.split('\n')
html_start = 27
html_end = 331
print("Backticks found inside htmlContent block:")
for i, line in enumerate(lines[html_start-1:html_end-1], start=html_start):
    if bt in line:
        print(f'  Line {i}: {line.strip()[:120]}')
