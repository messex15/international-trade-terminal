// Prints a fresh SESSION_SECRET for the Freight Desk.
// Paste it into Netlify: Project configuration > Environment variables.
import { randomBytes } from "node:crypto";

console.log(`SESSION_SECRET=${randomBytes(48).toString("base64url")}`);
