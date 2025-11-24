import markdown
import os
import sys

def convert_markdown_to_html(input_file, output_file):
    """
    Reads a Markdown file and writes the converted HTML to an output file.
    """
    try:
        if not os.path.exists(input_file):
            print(f"Error: The file '{input_file}' was not found.")
            return

        with open(input_file, 'r', encoding='utf-8') as f:
            text = f.read()
        
        # Convert markdown to html
        # extensions=['extra'] enables features like tables, footnotes, etc.
        html = markdown.markdown(text, extensions=['extra'])

        # Wrap in a basic HTML structure if needed, or just output the fragment.
        # For a complete page, we might want to add <html><body>...
        full_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{os.path.basename(input_file)}</title>
<style>
body {{ font-family: sans-serif; line-height: 1.6; padding: 20px; max-width: 800px; margin: 0 auto; }}
pre {{ background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }}
code {{ background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }}
blockquote {{ border-left: 4px solid #ccc; margin: 0; padding-left: 10px; color: #666; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
th {{ background-color: #f2f2f2; }}
</style>
</head>
<body>
{html}
</body>
</html>
"""

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(full_html)
        
        print(f"Successfully converted '{input_file}' to '{output_file}'")

    except Exception as e:
        print(f"Error converting file: {e}")

if __name__ == "__main__":
    input_path = "Never Split the Difference Negotiating As If Your Life Depended On It - Chris Voss.md"

    base, _ = os.path.splitext(input_path)
    output_path = base + ".html"

    convert_markdown_to_html(input_path, output_path)
