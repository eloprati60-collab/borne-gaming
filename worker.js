const FULLY_API_URL = "https://api.fully-kiosk.com/remote/";

export default {
async fetch(request, env) {
try {
const response = await fetch(FULLY_API_URL, {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
email: env.FULLY_EMAIL,
apiKey: env.FULLY_API_KEY,
deviceId: env.FULLY_DEVICE_ID,
command: "loadURL",
parameter: "https://www.google.com"
})
});

const text = await response.text();

return new Response(
`Cloudflare → Fully : HTTP ${response.status}\n${text}`,
{ status: response.status }
);

} catch (error) {
return new Response(
`ERREUR : ${error.message}`,
{ status: 500 }
);
}
}
};
