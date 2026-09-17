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


// ======================================================
// FULLY CLOUD
// ======================================================

async function fullyLoadURL(env, targetURL) {

if (
!env.FULLY_EMAIL ||
!env.FULLY_API_KEY ||
!env.FULLY_DEVICE_ID
) {
throw new Error("Secrets Fully manquants");
}

console.log("FULLY LOAD URL :", targetURL);

const apiUrl = new URL(FULLY_API_URL);

// API Fully Cloud en GET
apiUrl.searchParams.set("apiemail", env.FULLY_EMAIL);
apiUrl.searchParams.set("apikey", env.FULLY_API_KEY);
apiUrl.searchParams.set("devid", env.FULLY_DEVICE_ID);
apiUrl.searchParams.set("cmd", "loadURL");
apiUrl.searchParams.set("url", targetURL);

const response = await fetch(apiUrl.toString(), {
method: "GET"
});

const text = await response.text();

console.log("FULLY HTTP STATUS :", response.status);
console.log("FULLY RESPONSE :", text);

if (!response.ok) {
throw new Error(
`Fully HTTP ${response.status} : ${text}`
);
}

return text;
}


// ======================================================
// SUMUP - CREATION DU PAIEMENT
// ======================================================

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
amount: amount,
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


// ======================================================
// SUMUP - VERIFICATION DU PAIEMENT
// ======================================================

async function getSumUpCheckout(env, checkoutId) {

const response = await fetch(
`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`,
{
method: "GET",

headers: {
Authorization:
`Bearer ${env.SUMUP_API_KEY}`
}
}
);

const data = await response.json();

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


// ======================================================
// DURABLE OBJECT - TIMER DE SESSION
// ======================================================

export class SessionTimer extends DurableObject {

async fetch(request) {

const url = new URL(request.url);


// ----------------------------------------------
// DEMARRER LE TIMER
// ----------------------------------------------

if (url.pathname === "/start") {

// TEST : 1 minute
// On passera à 20 ou 60 minutes ensuite.

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


// ----------------------------------------------
// ANNULER LE TIMER
// ----------------------------------------------

if (url.pathname === "/cancel") {

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


// ----------------------------------------------
// FIN DU TIMER
// ----------------------------------------------

async alarm() {

console.log(
"TIMER ALARM : session terminée"
);

try {

// Retour à la page QR
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


// ======================================================
// WORKER PRINCIPAL
// ======================================================

export default {

async fetch(request, env) {

const url = new URL(request.url);


// ==================================================
// TEST GOOGLE
// ==================================================

if (url.pathname === "/test-google") {

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


// ==================================================
// TEST FC26
// ==================================================

if (url.pathname === "/test-fully") {

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


// ==================================================
// TEST TIMER
// ==================================================

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


// ==================================================
// PAGE PRINCIPALE
// ==================================================

if (url.pathname === "/") {

return new Response(
"BORNE GAMING OK"
);
}


// ==================================================
// PAIEMENT TEST
// ==================================================

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


// ==================================================
// CREATION D'UN PAIEMENT
// ==================================================

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


// ----------------------------------------------
// VERIFICATIONS
// ----------------------------------------------

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


// ----------------------------------------------
// REFERENCE SUMUP
// ----------------------------------------------

const reference =
`BORNE-${borne}-${jeu}-${duree}-${Date.now()}`;


console.log(
"CREATION CHECKOUT :",
reference
);


// ----------------------------------------------
// CREATION PAIEMENT
// ----------------------------------------------

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


// ----------------------------------------------
// REDIRECTION VERS SUMUP
// ----------------------------------------------

return Response.redirect(
checkout.hosted_checkout_url,
303
);

} catch (error) {

console.error(
"PAY ERROR :",
error
);
