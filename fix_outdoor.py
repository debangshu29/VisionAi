import_a = open(r'D:\django\vision\vision_app\app\(tabs)\outdoor.tsx', encoding='utf-8').read()

# Find the bad section: starts right after "ctx.textBaseline='alphabetic';\n" and ends before "function startCamera"
start_marker = "ctx.textAlign='left'; ctx.textBaseline='alphabetic';\n"
end_marker = "\n    function startCamera(facingMode) {"

start_idx = import_a.find(start_marker)
end_idx = import_a.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("MARKERS NOT FOUND")
    print("start:", start_idx, "end:", end_idx)
else:
    # Replace the garbage between them with just closing the loop properly
    replacement = (
        "ctx.textAlign='left'; ctx.textBaseline='alphabetic';\n"
        "              ctx.fillText(box.class_name,x1+4,y1-6);\n"
        "            }\n"
        "          }\n"
        "        }\n"
        "        window._arrowRafId = requestAnimationFrame(loop);\n"
        "      }\n"
        "      window._arrowRafId = requestAnimationFrame(loop);\n"
        "    }\n"
    )
    fixed = import_a[:start_idx] + replacement + import_a[end_idx:]
    open(r'D:\django\vision\vision_app\app\(tabs)\outdoor.tsx', 'w', encoding='utf-8').write(fixed)
    print("Fixed! New length:", fixed.count('\n'), "lines")
