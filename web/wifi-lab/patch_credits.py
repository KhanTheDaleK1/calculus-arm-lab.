import os

files = [
    "../index.html",
    "../arm/index.html",
    "../black-car/index.html",
    "../grey-car/index.html",
    "../microphone-labs/index.html"
]

footer_html = """
    <footer>
        <div style="margin-bottom:10px;">
            &copy; 2025 <strong>Evan Beechem</strong>. All rights reserved. <br>
            <span style="opacity:0.7;">Open Source Project</span>
        </div>
        <div style="margin-bottom:15px;">
            <a href="#" class="btn-credits-trigger" style="color:var(--text-dim); text-decoration:none; margin:0 10px; border-bottom:1px dotted #555;">Credits</a>
            <a href="#" class="btn-eula-trigger" style="color:var(--text-dim); text-decoration:none; margin:0 10px; border-bottom:1px dotted #555;">EULA & License</a>
        </div>
    </footer>
"""

modals_html = """
    <!-- CREDITS MODAL -->
    <div id="credits-modal" class="modal-overlay">
        <div class="modal-content" style="max-width: 500px;">
            <span class="modal-close">&times;</span>
            <h2 style="color:var(--accent); border-bottom:1px solid #333; padding-bottom:10px;">Credits</h2>
            <div style="line-height:1.6; color:#ccc;">
                <h3 style="color:#fff; margin-bottom:5px;">Lead Developer & Creator</h3>
                <p style="margin-top:0;">Evan Beechem</p>
                
                <h3 style="color:#fff; margin-bottom:5px;">Project</h3>
                <p style="margin-top:0;">Calculus Arm & Wi-Fi Dynamics Lab</p>

                <h3 style="color:#fff; margin-bottom:5px;">Contributions</h3>
                <p style="margin-top:0; font-style:italic; color:#777;">[Placeholder for future contributors]</p>
                
                <h3 style="color:#fff; margin-bottom:5px;">Libraries & Tools</h3>
                <ul style="margin-top:0; padding-left:20px; color:#999;">
                    <li>FontAwesome (Icons)</li>
                    <li>Google Fonts (Segoe UI)</li>
                    <li>HTML5 Audio API (DSP)</li>
                    <li>Plotly.js</li>
                </ul>
            </div>
        </div>
    </div>

    <!-- EULA MODAL -->
    <div id="eula-modal" class="modal-overlay">
        <div class="modal-content" style="max-width: 600px; max-height:80vh; overflow-y:auto;">
            <span class="modal-close">&times;</span>
            <h2 style="color:var(--accent); border-bottom:1px solid #333; padding-bottom:10px;">End User License Agreement</h2>
            <div style="line-height:1.5; color:#ccc; font-size:0.9rem;">
                <p><strong>Last Updated: December 2025</strong></p>
                
                <h3>1. Acceptance of Terms</h3>
                <p>By accessing and using this application ("Software"), you agree to be bound by the terms of this agreement. This application is provided primarily for <strong>non-commercial, educational purposes</strong>.</p>

                <h3>2. Ownership & Copyright</h3>
                <p>The Software is the intellectual property of <strong>Evan Beechem</strong>. <br>Copyright &copy; 2025 Evan Beechem. All rights reserved.</p>

                <h3>3. Open Source License (MIT)</h3>
                <p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p>
                <p style="background:#222; padding:10px; border-radius:4px; font-family:monospace; font-size:0.8rem;">The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p>

                <h3>4. Disclaimer of Warranty</h3>
                <p style="text-transform:uppercase; color:#aaa;">THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</p>

                <h3>5. Governing Law</h3>
                <p>This agreement shall be governed by and construed in accordance with the laws of the State of California, without regard to its conflict of law principles.</p>
            </div>
        </div>
    </div>
"""

script_tag = '<script src="{}/js/site-footer.js"></script>'

for file_path in files:
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        
        if "id=\"credits-modal\"" in content:
            print(f"Skipping {file_path}, already patched.")
            continue
        
        # Calculate relative path to js
        depth = file_path.count('/') - 1 # ../index.html is depth 0? No. 
        # ../index.html -> root. ../arm/index.html -> 1 level deep from root.
        # But we are in wifi-lab/
        # ../ is web/
        # ../js/ is web/js/
        # So for ../index.html, src="js/site-footer.js"
        # For ../arm/index.html, src="../js/site-footer.js"
        
        # Actually easier: relative to the file.
        # ../index.html is in web/. js is in web/js. -> src="js/site-footer.js"
        # ../arm/index.html is in web/arm/. js is in web/js. -> src="../js/site-footer.js"
        
        rel_js_path = ""
        if file_path == "../index.html":
             rel_js_path = "."
        else:
             rel_js_path = ".."
        
        current_script_tag = script_tag.format(rel_js_path)

        # INSERT FOOTER
        # Look for </main>
        if "</main>" in content:
            content = content.replace("</main>", "</main>" + footer_html)
        elif "class=\"bento-grid\"" in content:
             # Find the closing div for bento-grid. This is risky with simple replace.
             # Microphone lab: <div class="bento-grid"> ... </div> </div>
             # It ends with </div> </div> (grid close, container close).
             # We can try to insert before the last </div> if we can guess it, or just before </body> but inside a wrapper?
             # No, standard is inside .app-container.
             
             # Locate the last </div> before <script...
             # Actually, just inserting before </body> works for the footer too if we style it right?
             # But we want it inside .app-container if possible.
             
             # Let's try to insert before the scripts start.
             if "<script" in content:
                 first_script_idx = content.find("<script")
                 # Check if there's a closing div before that?
                 # Safe bet: Insert before </body> and hope CSS handles it or it sits at bottom.
                 # But we want it inside .app-container for layout reasons?
                 # In mic lab, .app-container has height:100vh usually, but we changed CSS to auto.
                 # So putting it at the end of .app-container is fine.
                 
                 # Let's rely on </main> for most. For Mic lab, I'll regex or string find.
                 pass
        
        # Fallback if no </main>: Insert before the last </div> if we can guess it, or just before </body> but inside a wrapper?
        # Let's rely on </main> for most. For Mic lab, I'll regex or string find.
        if "Microphone Labs" in content and "</main>" not in content:
             # It ends with </div>\n</div>\n\n<script
             # The last div is app-container close?
             # Let's insert footer before <script src="../js/mic-app.js">
             target = '<script src="../js/mic-app.js">'
             content = content.replace(target, footer_html + target)

        # INSERT MODALS AND SCRIPT
        content = content.replace("</body>", modals_html + "\n" + current_script_tag + "\n</body>")

        with open(file_path, 'w') as f:
            f.write(content)
        print(f"Patched {file_path}")

    except Exception as e:
        print(f"Error patching {file_path}: {e}")
