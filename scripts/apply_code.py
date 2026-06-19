import os
import re
import sys

def build_prompt(input_file):
    """Convert raw prompt (with source_file tags) into a complete prompt with original code injected."""
    if not os.path.exists(input_file):
        print(f"[ERROR] Input file not found: {input_file}")
        return

    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex to find: <source_file path="..." /> or <source_file path="..." lines="x-y" />
    pattern = r'<source_file\s+path="([^"]+)"(?:\s+lines="(\d+)-(\d+)")?\s*/>'

    def replace_source(match):
        filepath = match.group(1).strip()
        start_line = match.group(2)
        end_line = match.group(3)

        if not os.path.exists(filepath):
            return f"[ERROR] File not found: {filepath}\n"

        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        if start_line and end_line:
            start = int(start_line) - 1
            end = int(end_line)
            selected_lines = lines[start:end]
            offset = start + 1
        else:
            selected_lines = lines
            offset = 1

        formatted = []
        for i, line in enumerate(selected_lines):
            formatted.append(f"{offset + i}: {line}")
        
        return "".join(formatted)

    built_content = re.sub(pattern, replace_source, content)
    output_file = "prompt_built.md"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(built_content)
    print(f"[OK] Built prompt written to {output_file}")

def apply_changes(input_file):
    """Parse AI 2's output and apply code changes to the project files."""
    if not os.path.exists(input_file):
        print(f"[ERROR] Output file not found: {input_file}")
        return

    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex to find: <file path="...">code</file> or <file path="..." lines="x-y">code</file>
    # Note: re.DOTALL is used to match multi-line contents.
    pattern = r'<file\s+path="([^"]+)"(?:\s+lines="(\d+)-(\d+)")?\s*>(.*?)</file>'
    matches = list(re.finditer(pattern, content, re.DOTALL))

    if not matches:
        print("[WARN] No <file> tags found in the input file.")
        return

    for match in matches:
        filepath = match.group(1).strip()
        start_line = match.group(2)
        end_line = match.group(3)
        code = match.group(4)

        # Normalize windows newlines and remove leading/trailing empty lines if any from the parsed code
        # but keep indentation
        code_lines = code.splitlines()
        if code_lines and not code_lines[0].strip():
            code_lines.pop(0)
        if code_lines and not code_lines[-1].strip():
            code_lines.pop()
        code = "\n".join(code_lines) + "\n"

        if start_line and end_line:
            start = int(start_line)
            end = int(end_line)
            if not os.path.exists(filepath):
                print(f"[ERROR] File does not exist to replace lines: {filepath}")
                continue

            with open(filepath, 'r', encoding='utf-8') as f:
                file_content = f.read()
            
            lines = file_content.splitlines(keepends=True)
            # Replace target lines (1-based index)
            # lines[start-1:end] should be replaced by code
            # Note: end is inclusive in our tag, so lines[start-1:end] is correct in python slice
            lines[start-1:end] = [code]

            with open(filepath, 'w', encoding='utf-8') as f:
                f.write("".join(lines))
            print(f"[OK] Replaced lines {start}-{end} in {filepath}")
        else:
            # Overwrite/Create file
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(code)
            print(f"[OK] Wrote complete file to {filepath}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage:")
        print("  python scripts/apply_code.py build <prompt_file.md>")
        print("  python scripts/apply_code.py apply <ai2_output_file.md>")
        sys.exit(1)

    mode = sys.argv[1]
    target = sys.argv[2]

    if mode == "build":
        build_prompt(target)
    elif mode == "apply":
        apply_changes(target)
    else:
        print(f"[ERROR] Unknown mode: {mode}")
        sys.exit(1)
