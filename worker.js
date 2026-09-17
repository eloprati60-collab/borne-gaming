/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
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
// DURABLE OBJECT : MINUTEUR DE SESSION
// ======================================================

export class SessionTimer extends DurableObject {

async fetch(request) {
const url = new URL(request.url);

if (url.pathname === "/start") {

// TEST : retour au QR après 1 minute
await this.ctx.storage.setAlarm(
Date.now() + 60 * 1000
);

console.log("Session timer démarré : 1 minute");

return new Response("Session timer started");
}

if (url.pathname === "/cancel") {

await this.ctx.storage.deleteAlarm();

console.log("Session timer annulé");

return new Response("Session timer cancelled");
}

return new Response("SessionTimer OK");
}

async alarm() {

try {

console.log("Alarme déclenchée : retour au QR");

await fullyLoadURL(
this.env,
QR_URL
);

console.log("Retour QR envoyé à Fully");

} catch (error) {

console.error(
"Erreur retour QR :",
error
);
}
}
}


// ======================================================
// FONCTION FULLY KIOSK
// ======================================================

async function fullyLoadURL(env, url) {

const email = env.FULLY_EMAIL;
const apiKey = env.FULLY_API_KEY;
const deviceId = env.FULLY_DEVICE_ID;

if (!email || !apiKey || !deviceId) {
throw new Error(
"Secrets Fully manquants"
);
}

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
parameter: url
})
}
);

const text = await response.text();

console.log(
"Réponse Fully :",
text
);

if (!response.ok) {

throw new Error(
`Erreur Fully ${response.status}: ${text}`
);
}

return text;
}


// ======================================================
// SUMUP : CRÉATION DU CHECKOUT
// ======================================================

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

return_url:
"https://borne-gaming.eloprati60.workers.dev/webhook"
})
}
);

const data =
await response.json();

console.log(
"Réponse SumUp :",
data
);

if (!response.ok) {

throw new Error(
`Erreur SumUp ${response.status}: ${JSON.stringify(data)}`
);
}

return data;
}


// ======================================================
// SUMUP : VÉRIFICATION DU PAIEMENT
// ======================================================

async function getSumUpCheckout(
env,
checkoutId
) {

const response = await fetch(
`https://api.sumup.com/v0.1/checkouts/${checkoutId}`,
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
"Vérification SumUp :",
data
);

if (!response.ok) {

throw new Error(
`Erreur vérification SumUp ${response.status}: ${JSON.stringify(data)}`
);
}

return data;
}


// ======================================================
// ROUTES WORKER
// ======================================================

export default {

async fetch(request, env) {

const url =
new URL(request.url);


// ==================================================
// PAGE PRINCIPALE
// ==================================================

if (url.pathname === "/") {

return new Response(
"BORNE GAMING OK",
{
status: 200,

headers: {
"Content-Type":
"text/plain; charset=utf-8"
}
}
);
}


// ==================================================
// PAIEMENT TEST 1 €
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
checkout.checkout_url,
303
);

} catch (error) {

console.error(error);

return new Response(
`Erreur paiement test : ${error.message}`,
{
status: 500
}
);
}
}


// ==================================================
// CRÉATION DU PAIEMENT
//
// /pay?borne=001&jeu=fc26&duree=20
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


// Vérification borne

if (!borne) {

return new Response(
"Borne manquante",
{
status: 400
}
);
}


// Vérification jeu

if (!GAMES[jeu]) {

return new Response(
"Jeu invalide",
{
status: 400
}
);
}


// Vérification durée

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


return Response.redirect(
checkout.checkout_url,
303
);

} catch (error) {

console.error(error);

return new Response(
`Erreur création paiement : ${error.message}`,
{
status: 500
}
);
}
}


// ==================================================
// WEBHOOK / RETOUR SUMUP
// ==================================================

if (url.pathname === "/webhook") {

try {

let checkoutId =
url.searchParams.get(
"checkout_id"
);


// Tentative récupération depuis
// le corps JSON

if (!checkoutId) {

try {

const body =
await request.json();

checkoutId =
body.checkout_id ||
body.id ||
null;

} catch (_) {

// Aucun JSON
}
}


if (!checkoutId) {

return new Response(
"checkout_id manquant",
{
status: 400
}
);
}


// ----------------------------------------------
// Vérification du paiement auprès de SumUp
// ----------------------------------------------

const checkout =
await getSumUpCheckout(
env,
checkoutId
);


console.log(
"Checkout vérifié :",
JSON.stringify(checkout)
);


// ----------------------------------------------
// Vérification statut
// ----------------------------------------------

const status =
String(
checkout.status || ""
).toUpperCase();


if (
status !== "PAID" &&
status !== "SUCCESSFUL"
) {

return new Response(
`Paiement non confirmé : ${status}`,
{
status: 400
}
);
}


// ----------------------------------------------
// Récupération référence
// ----------------------------------------------

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
"Référence paiement invalide",
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


// ----------------------------------------------
// Vérification jeu
// ----------------------------------------------

if (!GAMES[jeu]) {

return new Response(
"Jeu invalide",
{
status: 400
}
);
}


// ----------------------------------------------
// Vérification durée
// ----------------------------------------------

if (!PRICES[duree]) {

return new Response(
"Durée invalide",
{
status: 400
}
);
}


// ----------------------------------------------
// LANCEMENT DU JEU
// ----------------------------------------------

const gameURL =
GAMES[jeu].url;


await fullyLoadURL(
env,
gameURL
);


console.log(
`Jeu lancé : ${jeu} sur borne ${borne}`
);


// ----------------------------------------------
// DÉMARRAGE DU TIMER
// ----------------------------------------------

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


console.log(
`Timer démarré pour borne ${borne}`
);


return new Response(
"Paiement confirmé - jeu lancé - minuteur démarré",
{
status: 200
}
);

} catch (error) {

console.error(
"Erreur webhook :",
error
);

return new Response(
`Erreur webhook : ${error.message}`,
{
status: 500
}
);
}
}


// ==================================================
// TEST DIRECT FULLY
// ==================================================

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

console.error(error);

return new Response(
`Erreur Fully : ${error.message}`,
{
status: 500
}
);
}
}


// ==================================================
// ROUTE INCONNUE
// ==================================================

return new Response(
"Route inconnue",
{
status: 404
}
);
}
};
