
with open("index.html", "r") as f:
    lines = f.readlines()

new_lines = []
skip = False

# First script block (55-223)
# Second script block (224-279)
# Functional block (4399-6847)
# Browser block (6852-7466)
# Spacer block (8033-8057)

i = 0
while i < len(lines):
    line_num = i + 1
    
    if line_num == 55:
        new_lines.append('<script src="core_components.js"></script>\n')
        new_lines.append('<script>\n')
        new_lines.append('// ===== EARLY BAN CHECK =====\n')
        new_lines.append('(function() { if (window.Core && window.Core.EarlyBanCheck) window.Core.EarlyBanCheck(); })();\n')
        new_lines.append('</script>\n')
        skip = True
    elif line_num == 224:
        skip = True
    elif line_num == 4399:
        # Keep jsbarcode script
        # new_lines.append('<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>\n')
        new_lines.append('<script>\n')
        new_lines.append('// ===== MAIN INIT =====\n')
        new_lines.append('document.addEventListener("DOMContentLoaded", function() { if (window.Core && window.Core.init) window.Core.init(); });\n')
        new_lines.append('</script>\n')
        skip = True
    elif line_num == 6852:
        skip = True
    elif line_num == 8033:
        skip = True
        
    if not skip:
        new_lines.append(lines[i])
        
    if line_num == 223: skip = False
    elif line_num == 279: skip = False
    elif line_num == 6847: skip = False
    elif line_num == 7466: skip = False
    elif line_num == 8057: skip = False
    
    i += 1

with open("index.html", "w") as f:
    f.writelines(new_lines)
