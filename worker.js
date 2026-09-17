import { DurableObject } from "cloudflare:workers";

const FULLY_API_URL = "https://api.fully-kiosk.com/remote/";
const QR_URL = "https://testsrcodejeux.carrd.co/?borne=001";

const GAMES = {
fc26: {
url: "https://www.xbox.com/fr-FR/play/launch/ea-sports-fc-26-pour-xbox-series-x%7Cs/9P9FTXPKQ35P"
}
};

const PRICES = {
20: 3,
60: 5
};

export class SessionTimer extends DurableObject {
async fetch(request) {
const url = new URL(request.url);

if (url.pathname === "/start") {
await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
console.log("TIMER START : 1 minute");
return new Response("Timer started");
}

if (url.pathname === "/cancel") {
await this.ctx.storage.deleteAlarm();
return new Response("Timer cancelled");
}

return new Response("SessionTimer OK");
}

async alarm() {
console.log("TIMER ALARM : session terminée");

try {
await fullyLoadURL(this.env, QR_URL);
console.log("TIMER : retour QR envoyé");
} catch (error) {
console.error("TIMER ALARM ERROR :", error.message);
}
}
}

async function fullyCommand(env, command, parameter = "") {
const email = env.FULLY_EMAIL;
const apiKey = env.FULLY_API_KEY;
const deviceId = env.FULLY_DEVICE_ID;

if (!email || !apiKey || !deviceId) {
throw new Error("Secrets Fully manquants");
}

const payload = {
email,
apiKey,
deviceId,
command
};

if (parameter !== "") {
payload.parameter = parameter;
}

console.log("FULLY COMMAND :", command);

const response = await fetch(FULLY_API_URL, {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(payload)
});

const text = await response.text();

console.log("FULLY RESPONSE :", text);

if (!response.ok) {
throw new Error(
`Fully HTTP ${response.status} : ${text}`
);
}

return text;
}

async function fullyLoadURL(env, targetURL) {
return await fullyCommand(env, "loadURL", targetURL);
}

async function createSumUpCheckout(env, amount, reference) {
const response = await fetch(
"https://api.sumup.com/v0.1/checkouts",
{
method: "POST",
headers: {
Authorization: `Bearer ${env.SUMUP_API_KEY}`,
"Content-Type": "application/json"
},
body: JSON.stringify({
checkout_reference: reference,
amount,
currency: "EUR",
merchant_code: env.SUMUP_MERCHANT_CODE,
hosted_checkout: {
enabled: true
},
return_url:
"https://borne-gaming.eloprati60.workers.dev/webhook"
})
}
);

const data = await response.json();

if (!response.ok) {
throw new Error(
`SumUp create HTTP ${response.status}`
);
}

if (!data.hosted_checkout_url) {
throw new Error("URL SumUp absente");
}

return data;
}

async function getSumUpCheckout(env, checkoutId) {
const response = await fetch(
`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(
checkoutId
)}`,
{
headers: {
Authorization: `Bearer ${env.SUMUP_API_KEY}`
}
}
);

const data = await response.json();

if (!response.ok) {
throw new Error(
`SumUp verify HTTP ${response.status}`
);
}

return data;
}

export default {
async fetch(request, env) {
const url = new URL(request.url);

if (url.pathname === "/") {
return new Response("BORNE GAMING OK");
}

if (url.pathname === "/test-fully") {
try {
// Petit délai pour laisser Fully traiter la commande précédente
await new Promise(resolve => setTimeout(resolve, 500));

await fullyCommand(
env,
"loadURL",
GAMES.fc26.url
);

return new Response("FC26 lancé");
} catch (error) {
console.error("TEST FULLY ERROR :", error);

return new Response(
`Erreur Fully : ${error.message}`,
{ status: 500 }
);
}
}

if (url.pathname === "/test-timer") {
try {
const borne =
url.searchParams.get("borne") || "001";

const timer =
env.SESSION_TIMER.getByName(
`borne-${borne}`
);

await timer.fetch(
"https://session/start",
{ method: "POST" }
);

return new Response(
`Timer démarré pour la borne ${borne}`
);
} catch (error) {
console.error("TEST TIMER ERROR :", error);

return new Response(
`Erreur timer : ${error.message}`,
{ status: 500 }
);
}
}

if (url.pathname === "/pay") {
try {
const borne = url.searchParams.get("borne");
const jeu = url.searchParams.get("jeu");
const duree = Number(
url.searchParams.get("duree")
);

if (!borne) {
return new Response("Borne manquante", {
status: 400
});
}

if (!GAMES[jeu]) {
return new Response("Jeu invalide", {
status: 400
});
}

if (!PRICES[duree]) {
return new Response("Durée invalide", {
status: 400
});
}

const reference =
`BORNE-${borne}-${jeu}-${duree}-${Date.now()}`;

const checkout =
await createSumUpCheckout(
env,
PRICES[duree],
reference
);

return Response.redirect(
checkout.hosted_checkout_url,
303
);
} catch (error) {
return new Response(
`Erreur paiement : ${error.message}`,
{ status: 500 }
);
}
}

if (url.pathname === "/webhook") {
try {
let body = {};

try {
body = await request.json();
} catch {}

const checkoutId =
url.searchParams.get("checkout_id") ||
url.searchParams.get("id") ||
body.checkout_id ||
body.id ||
body.payload?.checkout_id ||
body.payload?.id;

if (!checkoutId) {
return new Response(
"Checkout ID absent",
{ status: 400 }
);
}

const checkout =
await getSumUpCheckout(
env,
checkoutId
);

const status =
String(checkout.status || "").toUpperCase();

if (status !== "PAID") {
return new Response(
"Paiement non confirmé",
{ status: 200 }
);
}

const reference =
checkout.checkout_reference ||
checkout.reference ||
"";

const match =
reference.match(
/^BORNE-([^-]+)-([^-]+)-(\d+)-/
);

if (!match) {
return new Response(
"Référence invalide",
{ status: 400 }
);
}

const borne = match[1];
const jeu = match[2];
const duree = Number(match[3]);

if (!GAMES[jeu] || !PRICES[duree]) {
return new Response(
"Session invalide",
{ status: 400 }
);
}

await fullyLoadURL(
env,
GAMES[jeu].url
);

const timer =
env.SESSION_TIMER.getByName(
`borne-${borne}`
);

await timer.fetch(
"https://session/start",
{ method: "POST" }
);

return new Response("OK");
} catch (error) {
console.error(
"WEBHOOK ERROR :",
error.message
);

return new Response(
`Erreur webhook : ${error.message}`,
{ status: 500 }
);
}
}

return new Response(
"Route inconnue",
{ status: 404 }
);
}
};
