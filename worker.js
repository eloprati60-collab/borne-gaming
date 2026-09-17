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
// TEST : 1 minute
// Après validation : 20 minutes
await this.ctx.storage.setAlarm(
Date.now() + 60 * 1000
);

console.log("TIMER START : 1 minute");

return new Response("Timer started");
}

if (url.pathname === "/cancel") {
await this.ctx.storage.deleteAlarm();

console.log("TIMER CANCEL");

return new Response("Timer cancelled");
}

return new Response("SessionTimer OK");
}

async alarm() {
console.log("TIMER ALARM : session terminée");

try {
await fullyLoadURL(this.env, QR_URL);

console.log("TIMER ALARM : retour QR envoyé");
} catch (error) {
console.error(
"TIMER ALARM ERROR :",
error.message
);
}
}
}

async function fullyLoadURL(env, targetURL) {
const email = env.FULLY_EMAIL;
const apiKey = env.FULLY_API_KEY;
const deviceId = env.FULLY_DEVICE_ID;

if (!email || !apiKey || !deviceId) {
throw new Error("Secrets Fully manquants");
}

console.log(
"FULLY LOAD URL :",
targetURL
);

const response = await fetch(
FULLY_API_URL,
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
email,
apiKey,
deviceId,
command: "loadURL",
parameter: targetURL
})
}
);

const text =
await response.text();

console.log(
"FULLY RESPONSE :",
text
);

if (!response.ok) {
throw new Error(
`Fully HTTP ${response.status} : ${text}`
);
}

return text;
}

async function createSumUpCheckout(
env,
amount,
reference
) {
console.log(
"SUMUP CREATE :",
amount,
reference
);

const response = await fetch(
"https://api.sumup.com/v0.1/checkouts",
{
method: "POST",
headers: {
"Authorization":
`Bearer ${env.SUMUP_API_KEY}`,
"Content-Type":
"application/json"
},
body: JSON.stringify({
checkout_reference:
reference,
amount:
amount,
currency:
"EUR",
merchant_code:
env.SUMUP_MERCHANT_CODE,
hosted_checkout: {
enabled: true
},
return_url:
"https://borne-gaming.eloprati60.workers.dev/webhook"
})
}
);

const data =
await response.json();

console.log(
"SUMUP CREATE RESPONSE :",
JSON.stringify(data)
);

if (!response.ok) {
throw new Error(
`SumUp create HTTP ${response.status} : ${JSON.stringify(data)}`
);
}

if (!data.hosted_checkout_url) {
throw new Error(
"SumUp : hosted_checkout_url absent"
);
}

return data;
}

async function getSumUpCheckout(
env,
checkoutId
) {
console.log(
"SUMUP VERIFY ID :",
checkoutId
);

const response = await fetch(
`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`,
{
method: "GET",
headers: {
"Authorization":
`Bearer ${env.SUMUP_API_KEY}`
}
}
);

const data =
await response.json();

console.log(
"SUMUP VERIFY RESPONSE :",
JSON.stringify(data)
);

if (!response.ok) {
throw new Error(
`SumUp verify HTTP ${response.status} : ${JSON.stringify(data)}`
);
}

return data;
}

export default {
async fetch(request, env) {
const url =
new URL(request.url);

console.log(
"REQUEST :",
request.method,
url.pathname
);

if (url.pathname === "/") {
return new Response(
"BORNE GAMING OK"
);
}

if (url.pathname === "/paiement-test") {
try {
const reference =
`TEST-${Date.now()}`;

const checkout =
await createSumUpCheckout(
env,
1,
reference
);

return Response.redirect(
checkout.hosted_checkout_url,
303
);

} catch (error) {
console.error(
"PAIEMENT TEST ERROR :",
error
);

return new Response(
`Erreur paiement test : ${error.message}`,
{
status: 500
}
);
}
}

if (url.pathname === "/pay") {
try {
const borne =
url.searchParams.get("borne");

const jeu =
url.searchParams.get("jeu");

const duree =
Number(
url.searchParams.get("duree")
);

console.log(
"PAY REQUEST :",
borne,
jeu,
duree
);

if (!borne) {
return new Response(
"Borne manquante",
{
status: 400
}
);
}

if (!GAMES[jeu]) {
return new Response(
"Jeu invalide",
{
status: 400
}
);
}

if (!PRICES[duree]) {
return new Response(
"Durée invalide",
{
status: 400
}
);
}

const amount =
PRICES[duree];

const reference =
`BORNE-${borne}-${jeu}-${duree}-${Date.now()}`;

const checkout =
await createSumUpCheckout(
env,
amount,
reference
);

console.log(
"CHECKOUT CREATED :",
checkout.id
);

return Response.redirect(
checkout.hosted_checkout_url,
303
);

} catch (error) {
console.error(
"PAY ERROR :",
error
);

return new Response(
`Erreur paiement : ${error.message}`,
{
status: 500
}
);
}
}

if (url.pathname === "/webhook") {
try {
console.log(
"WEBHOOK RECU :",
request.method
);

let body = {};

try {
body =
await request.json();
} catch (error) {
console.log(
"WEBHOOK : aucun JSON exploitable"
);
}

console.log(
"WEBHOOK BODY :",
JSON.stringify(body)
);

const checkoutId =
url.searchParams.get(
"checkout_id"
) ||
url.searchParams.get(
"id"
) ||
body.checkout_id ||
body.id ||
body.payload?.checkout_id ||
body.payload?.id ||
null;

console.log(
"WEBHOOK CHECKOUT ID :",
checkoutId
);

if (!checkoutId) {
console.error(
"WEBHOOK ERROR : checkout ID absent"
);

return new Response(
"Webhook reçu mais checkout ID absent",
{
status: 400
}
);
}

const checkout =
await getSumUpCheckout(
env,
checkoutId
);

const status =
String(
checkout.status || ""
).toUpperCase();

console.log(
"CHECKOUT STATUS :",
status
);

if (status !== "PAID") {
console.log(
"PAIEMENT PAS ENCORE PAID :",
status
);

return new Response(
"Webhook reçu - paiement non confirmé",
{
status: 200
}
);
}

const reference =
checkout.checkout_reference ||
checkout.reference ||
body.checkout_reference ||
"";

console.log(
"CHECKOUT REFERENCE :",
reference
);

const match =
reference.match(
/^BORNE-([^-]+)-([^-]+)-(\d+)-/
);

if (!match) {
console.error(
"REFERENCE INVALIDE :",
reference
);

return new Response(
"Paiement OK mais référence borne invalide",
{
status: 400
}
);
}

const borne =
match[1];

const jeu =
match[2];

const duree =
Number(match[3]);

console.log(
"SESSION :",
borne,
jeu,
duree
);

if (!GAMES[jeu]) {
throw new Error(
`Jeu invalide : ${jeu}`
);
}

if (!PRICES[duree]) {
throw new Error(
`Durée invalide : ${duree}`
);
}

console.log(
"LANCEMENT JEU..."
);

await fullyLoadURL(
env,
GAMES[jeu].url
);

console.log(
"JEU LANCE"
);

const timerNamespace =
env.SESSION_TIMER;

if (!timerNamespace) {
throw new Error(
"SESSION_TIMER binding manquant"
);
}

const timer =
timerNamespace.getByName(
`borne-${borne}`
);

console.log(
"DEMARRAGE TIMER..."
);

await timer.fetch(
"https://session/start",
{
method: "POST"
}
);

console.log(
"TIMER DEMARRE"
);

return new Response(
"OK",
{
status: 200
}
);

} catch (error) {
console.error(
"WEBHOOK ERROR :",
error.message
);

console.error(
"WEBHOOK ERROR STACK :",
error.stack
);

return new Response(
`Erreur webhook : ${error.message}`,
{
status: 500
}
);
}
}

if (url.pathname === "/test-fully") {
try {
await fullyLoadURL(
env,
GAMES.fc26.url
);

return new Response(
"FC26 lancé avec succès"
);

} catch (error) {
console.error(
"TEST FULLY ERROR :",
error
);

return new Response(
`Erreur Fully : ${error.message}`,
{
status: 500
}
);
}
}

if (url.pathname === "/test-timer") {
try {
const borne =
url.searchParams.get("borne") ||
"001";

const timerNamespace =
env.SESSION_TIMER;

if (!timerNamespace) {
throw new Error(
"SESSION_TIMER binding manquant"
);
}

const timer =
timerNamespace.getByName(
`borne-${borne}`
);

await timer.fetch(
"https://session/start",
{
method: "POST"
}
);

return new Response(
`Timer démarré pour la borne ${borne}`
);

} catch (error) {
console.error(
"TEST TIMER ERROR :",
error
);

return new Response(
`Erreur timer : ${error.message}`,
{
status: 500
}
);
}
}

return new Response(
"Route inconnue",
{
status: 404
}
);
}
};
