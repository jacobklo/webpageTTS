import os
import base64
import mimetypes
from urllib.parse import unquote
from typing import List

import requests
from bs4 import BeautifulSoup

# Register common MIME types that might be missing
mimetypes.add_type('image/svg+xml', '.svg')
mimetypes.add_type('image/webp', '.webp')
mimetypes.add_type('image/png', '.png')
mimetypes.add_type('image/jpeg', '.jpg')
mimetypes.add_type('image/jpeg', '.jpeg')

def get_mime_type(path_or_url, content_bytes):
    """
    Determine MIME type from extension or content signature.
    """
    # 1. Try extension
    mime, _ = mimetypes.guess_type(path_or_url)
    if mime:
        return mime
        
    # 2. Try magic numbers (signatures)
    if content_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    elif content_bytes.startswith(b'\xff\xd8'):
        return 'image/jpeg'
    elif content_bytes.startswith(b'GIF87a') or content_bytes.startswith(b'GIF89a'):
        return 'image/gif'
    elif content_bytes.startswith(b'RIFF') and content_bytes[8:12] == b'WEBP':
        return 'image/webp'
    elif content_bytes.strip().startswith(b'<svg') or content_bytes.strip().startswith(b'<?xml'):
        return 'image/svg+xml'
        
    return 'application/octet-stream'

def fetch_resource(src, base_file_path):
    """
    Fetches the content of the image from URL or local path.
    Returns (content_bytes, mime_type) or (None, None) on failure.
    """
    # Skip existing data URIs
    if src.strip().startswith('data:'):
        return None, None

    content = None
    mime = None

    # Case A: Remote URL
    if src.startswith('http://') or src.startswith('https://'):
        try:
            print(f"  Downloading: {src}")
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            response = requests.get(src, headers=headers, timeout=15)
            response.raise_for_status()
            content = response.content
            mime = response.headers.get('Content-Type')
        except Exception as e:
            print(f"  [!] Error downloading {src}: {e}")
            return None, None
    
    # Case B: Local file
    else:
        # Resolve path relative to the HTML file
        if os.path.isabs(src):
            file_path = src
        else:
            base_dir = os.path.dirname(os.path.abspath(base_file_path))
            # Handle URL encoding in local paths (e.g. "My%20Image.png")
            decoded_src = unquote(src)
            file_path = os.path.join(base_dir, decoded_src)

        if os.path.exists(file_path) and os.path.isfile(file_path):
            try:
                # print(f"  Reading local file: {file_path}")
                with open(file_path, 'rb') as f:
                    content = f.read()
            except Exception as e:
                print(f"  [!] Error reading {file_path}: {e}")
                return None, None
        else:
            print(f"  [!] File not found: {file_path}")
            return None, None

    # Determine MIME type if missing
    if not mime or mime == 'application/octet-stream':
        mime = get_mime_type(src, content)

    return content, mime

def convert_to_soup(html_file_path):
    if not os.path.exists(html_file_path):
        print(f"Error: Input file not found: {html_file_path}")
        return

    base, ext = os.path.splitext(html_file_path)
    output_file_path = f"{base}_embedded{ext}"

    print(f"Processing HTML: {html_file_path}")
    
    try:
        with open(html_file_path, 'r', encoding='utf-8') as f:
            soup = BeautifulSoup(f, 'html.parser')
    except Exception as e:
        print(f"Failed to parse HTML file: {e}")
        return

    return soup


def embed_images(soup, html_file_path):
    count = 0

    # 1. Process <img> tags
    img_tags = soup.find_all('img')
    for img in img_tags:
        if img.get('src'):
            src = img['src']
            content, mime = fetch_resource(src, html_file_path)
            if content:
                b64_data = base64.b64encode(content).decode('utf-8')
                new_src = f"data:{mime};base64,{b64_data}"
                img['src'] = new_src
                # Remove srcset to prevent browser from loading external resources
                if img.has_attr('srcset'):
                    del img['srcset']
                count += 1

    # 2. Process <image> tags inside <svg>
    svg_image_tags = soup.find_all('image')
    for img in svg_image_tags:
        href = img.get('href') or img.get('xlink:href')
        if href:
            content, mime = fetch_resource(href, html_file_path)
            if content:
                b64_data = base64.b64encode(content).decode('utf-8')
                new_src = f"data:{mime};base64,{b64_data}"
                if img.has_attr('href'):
                    img['href'] = new_src
                if img.has_attr('xlink:href'):
                    img['xlink:href'] = new_src
                count += 1

    # 3. Process <input type="image">
    input_tags = soup.find_all('input', type='image')
    for inp in input_tags:
        if inp.get('src'):
            src = inp['src']
            content, mime = fetch_resource(src, html_file_path)
            if content:
                b64_data = base64.b64encode(content).decode('utf-8')
                inp['src'] = f"data:{mime};base64,{b64_data}"
                count += 1

    # 4. Process Favicons <link rel="icon">
    link_tags = soup.find_all('link')
    for link in link_tags:
        rels = link.get('rel', [])
        if isinstance(rels, str): rels = [rels]
        if any('icon' in r.lower() for r in rels) and link.get('href'):
            href = link['href']
            content, mime = fetch_resource(href, html_file_path)
            if content:
                b64_data = base64.b64encode(content).decode('utf-8')
                link['href'] = f"data:{mime};base64,{b64_data}"
                count += 1

    return soup


def save_to_html(soup, output_file_path):
    # Save result
    try:
        with open(output_file_path, 'w', encoding='utf-8') as f:
            f.write(str(soup))
        print(f"Saved to: {output_file_path}")
    except Exception as e:
        print(f"Failed to save output: {e}")


def embed_js_in_html(soup, html_file_path, js_file_path: List[str] = None):
    """
    Parses an HTML file, finds all <script src="..."> tags pointing to local files,
    reads the content of those files, and embeds them directly into the HTML.
    """

    count = 0
    script_tags = soup.find_all('script', src=True)

    # Add addition JS files if provided
    if js_file_path:
        for js_path in js_file_path:
            script_tag = soup.new_tag('script', src=js_path)
            soup.body.append(script_tag)
            script_tags.append(script_tag)

    for script in script_tags:
        src = script['src']
        
        # Skip remote scripts
        if src.startswith(('http://', 'https://', '//')):
            print(f"  [Skipping remote] {src}")
            continue

        # Resolve local path relative to the HTML file
        html_dir = os.path.dirname(os.path.abspath(html_file_path))
        js_path = os.path.join(html_dir, src)

        if os.path.exists(js_path) and os.path.isfile(js_path):
            try:
                with open(js_path, 'r', encoding='utf-8') as js_file:
                    js_content = js_file.read()
                
                # Remove the src attribute
                del script['src']
                # Embed the content
                script.string = js_content
                
                print(f"  [Embedded] {src}")
                count += 1
            except Exception as e:
                print(f"  [Error] Could not read {js_path}: {e}")
        else:
            print(f"  [Warning] File not found: {js_path}")

    return soup


if __name__ == "__main__":

    input_file = "Never Split the Difference Negotiating As If Your Life Depended On It - Chris Voss.html"  # Default input file
    soup = convert_to_soup(input_file)
    soup = embed_images(soup, input_file)
    soup = embed_js_in_html(soup, input_file, js_file_path=['chrome-extension/content.js'])
    base, ext = os.path.splitext(input_file)
    output_file = f"{base}_embedded{ext}"
    save_to_html(soup, output_file)
