Default: OpenRouter + deepseek/deepseek-v4-flash:free. Sirf API_KEY aur AUTH_TOKEN set karo.

Railway deploy:
1. Ye folder GitHub repo me push karo.
2. railway.com > New Project > Deploy from GitHub repo.
3. Variables: ANTHROPIC_API_KEY, AUTH_TOKEN (koi bhi lamba secret).
4. Settings > Networking > Generate Domain.
5. Browser me us domain ko kholo = control panel (likho ya bolo).

Provider badalna (Railway Variables):
 DeepSeek : BASE_URL=https://api.deepseek.com  MODEL=deepseek-v4-flash  API_KEY=<deepseek key>
 Gemini   : BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  MODEL=<Gemini model>  API_KEY=<AI Studio key>
 Claude   : BASE_URL khali, MODEL=claude-haiku-5-5, API_KEY=<anthropic key>

Naya: realtime events (📱), notifications (🔔), screenshot (👁).
 VISION_MODEL = image samajhne wala model (OpenRouter pe vision/multimodal wala chuno). Khali = sirf text.
 IMG_MODE = auto (text khali ho tab) | always | off
 Notifications AI ko tab jaate hain jab kaam me "notif" likha ho.

Chat mode: browser panel me pehle AI se baat karo, phir "task add kardo" bolo (ya button dabao).
Baat-cheet ek task me badal ke phone pe chalega. Chalte kaam ke beech add karoge to queue me jayega.
"Seedha chalao" = bina chat ke turant task.
