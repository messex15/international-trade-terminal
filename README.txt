INTERNATIONAL TRADE TERMINAL - Static Deployment Build

This folder is prebuilt and requires no npm/Vite build step.

Netlify manual deploy:
1. In Netlify, open the existing site.
2. Go to Deploys.
3. Drag this folder (or its ZIP after extracting) into the manual deploy area.
4. Netlify will publish index.html directly.

Important: this prototype loads React and Lucide modules from esm.sh at runtime. Keep confidential business data out until authentication and a secure backend are added.

Freight Desk (added):
The Freight Desk (/freight/ and Freight Desk in the portal sidebar) uses
Netlify Functions, an Edge Function and Netlify Blobs. Drag-and-drop may not
deploy those server parts, so deploy with the Netlify CLI or a Git-connected
site instead:
  npm install
  npx netlify-cli deploy --prod
Setup needs one environment variable (SESSION_SECRET). See FREIGHT-DESK.txt.
