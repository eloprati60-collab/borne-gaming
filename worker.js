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


// =========================
// FULLY
// =========================

async function fullyLoadURL(env, targetURL) {

if (
!env.FULLY_EMAIL ||
!env.FULLY_API_KEY ||
!env.FULLY_DEVICE_ID
) {
throw new Error("Secrets Fully manquants");
}

console.log("FULLY LOAD URL :", targetURL);

const response = await fetch(
FULLY_API_URL,
{
method: "POST",

headers: {
"Content-Type": "application/json"
},

body: JSON.stringify({
email: env.FULLY_EMAIL,
apiKey: env.FULLY_API_KEY,
deviceId: env.FULLY_DEVICE_ID,
command: "loadURL",
parameter: targetURL
})
}
);

const text = await response.text();

console.log(
"FULLY HTTP STATUS :",
response.status
);

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


// =========================
// SUMUP - CREATION
// =========================

async function createSumUpCheckout(
env,
amount,
reference
) {

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
"SumUp hosted_checkout_url absent"
);
}

return data;
}


// =========================
// SUMUP - VERIFICATION
// =========================

async function getSumUpCheckout(
env,
checkoutId
) {

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


// =========================
// DURABLE OBJECT
// =========================

export class SessionTimer extends DurableObject {

async fetch(request) {

const url =
new URL(request.url);

if (
url.pathname === "/start"
) {

// TEST : 1 minute
// Après validation : 20 minutes

await this.ctx.storage.setAlarm(
Date.now() + 60 * 1000
);

console.log(
"TIMER START : 1 minute"
);

return new Response(
"Timer started"
);
}


if (
url.pathname === "/cancel"
) {

await this.ctx.storage.deleteAlarm();

console.log(
"TIMER CANCEL"
);

return new Response(
"Timer cancelled"
);
}


return new Response(
"SessionTimer OK"
);
}


async alarm() {

console.log(
"TIMER ALARM : session terminée"
);

try {

await fullyLoadURL(
this.env,
QR_URL
);

console.log(
"TIMER ALARM : retour QR envoyé"
);

} catch (error) {

console.error(
"TIMER ALARM ERROR :",
error.message
);
}
}
}


// =========================
// WORKER
// =========================

export default {

async fetch(request, env) {

const url =
new URL(request.url);

console.log(
"REQUEST :",
request.method,
url.pathname
);


// =========================
// TEST GOOGLE
// =========================

if (
url.pathname === "/test-google"
) {

try {

await fullyLoadURL(
env,
"https://www.google.com"
);

return new Response(
"Google envoyé au Fire Stick"
);

} catch (error) {

console.error(
"TEST GOOGLE ERROR :",
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


// =========================
// TEST FC26
// =========================

if (
url.pathname === "/test-fully"
) {

try {

await fullyLoadURL(
env,
GAMES.fc26.url
);

return new Response(
"FC26 envoyé au Fire Stick"
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


// =========================
// TEST TIMER
// =========================

if (
url.pathname === "/test-timer"
) {

try {

const borne =
url.searchParams.get("borne") ||
"001";

const timer =
env.SESSION_TIMER.getByName(
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


// =========================
// ACCUEIL
// =========================

if (
url.pathname === "/"
) {

return new Response(
"BORNE GAMING OK"
);
}


// =========================
// PAIEMENT TEST
// =========================

if (
url.pathname === "/paiement-test"
) {

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


// =========================
// PAIEMENT
// =========================

if (
url.pathname === "/pay"
) {

try {

const borne =
url.searchParams.get("borne");

const jeu =
url.searchParams.get("jeu");

const duree =
Number(
url.searchParams.get("duree")
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


const reference =
`BORNE-${borne}-${jeu}-${duree}-${Date.now()}`;


const checkout =
await createSumUpCheckout(
env,
PRICES[duree],
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


// =========================
// WEBHOOK / RETOUR SUMUP
// =========================

if (
url.pathname === "/webhook"
) {

try {

console.log(
"WEBHOOK RECU :",
request.method
);


let body = {};

try {

body =
await request.json();

} catch {

console.log(
"WEBHOOK : pas de JSON"
);
}


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

return new Response(
"Checkout ID absent",
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


if (
status !== "PAID"
) {

return new Response(
"Paiement non confirmé",
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
"REFERENCE :",
reference
);


const match =
reference.match(
/^BORNE-([^-]+)-([^-]+)-(\d+)-/
);


if (!match) {

return new Response(
"Référence borne invalide",
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


// =========================
// LANCEMENT FC26
// =========================

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


// =========================
// TIMER
// =========================

const timer =
env.SESSION_TIMER.getByName(
`borne-${borne}`
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
"OK"
);

} catch (error) {

console.error(
"WEBHOOK ERROR :",
error.message
);

console.error(
"WEBHOOK STACK :",
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


// =========================
// ROUTE INCONNUE
// =========================

return new Response(
"Route inconnue",
{
status: 404
}
);
}
};
