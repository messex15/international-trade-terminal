AINU Business Command Centre - Static Deployment Build

This folder is prebuilt and requires no npm/Vite build step.

Netlify manual deploy:
1. In Netlify, open the existing site.
2. Go to Deploys.
3. Drag this folder (or its ZIP after extracting) into the manual deploy area.
4. Netlify will publish index.html directly.

Important: this prototype loads React and Lucide modules from esm.sh at runtime. Keep confidential business data out until authentication and a secure backend are added.
