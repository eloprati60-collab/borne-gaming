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


// ================================
// DURABLE OBJECT : TIMER
// ================================

export class SessionTimer extends DurableObject {

async fetch(request) {

const url = new URL(request.url);

// Démarrer le timer
if (url.pathname === "/start") {

// TEST : 1 minute
// Plus tard, on remettra 20 minutes
await this.ctx.storage.setAlarm(
Date.now() + 60 * 1000
);

console.log("Timer démarré : 1 minute");

return new Response(
"Session timer started"
);
}


// Annuler le timer
if (url.pathname === "/cancel") {

await this.ctx.storage.deleteAlarm();

console.log("Timer annulé");

return new Response(
"Session timer cancelled"
);
}


return new Response(
"SessionTimer OK"
);
}


// Quand le timer arrive à zéro
async alarm() {

try {

console.log(
"Timer terminé : retour QR"
);

await fullyLoadURL(
this.env,
QR_URL
);

console.log(
"Retour QR envoyé à Fully"
);

} catch (error) {

console.error(
"Erreur retour QR :",
error
);
}
}
}


// ================================
// FONCTION FULLY KIOSK
// ================================

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


const text =
await response.text();


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


// ================================
// CRÉATION PAIEMENT SUMUP
// ================================

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
"Réponse SumUp :",
data
);


if (!response.ok) {

throw new Error(
`Erreur SumUp ${response.status}: ${JSON.stringify(data)}`
);
}


if (!data.hosted_checkout_url) {

throw new Error(
"SumUp n'a pas retourné hosted_checkout_url"
);
}


return data;
}


// ================================
// VÉRIFICATION PAIEMENT SUMUP
// ================================

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


// ================================
// WORKER PRINCIPAL
// ================================

export default {

async fetch(request, env) {

const url =
new URL(request.url);


// ============================
// TEST WORKER
// ============================

if (url.pathname === "/") {

return new Response(
"BORNE GAMING OK"
);
}


// ============================
// PAIEMENT TEST 1€
// ============================

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

console.error(error);


return new Response(

`Erreur paiement test : ${error.message}`,

{
status: 500
}
);
}
}


// ============================
// PAIEMENT BORNE
// ============================

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


return Response.redirect(
checkout.hosted_checkout_url,
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


// ============================
// RETOUR / WEBHOOK SUMUP
// ============================

if (url.pathname === "/webhook") {

try {

let checkoutId =
url.searchParams.get(
"checkout_id"
);


// Si SumUp envoie du JSON
if (!checkoutId) {

try {

const body =
await request.json();


checkoutId =
body.checkout_id ||
body.id ||
null;

} catch (_) {}
}


if (!checkoutId) {

return new Response(
"checkout_id manquant",
{
status: 400
}
);
}


// Vérifier le paiement
const checkout =
await getSumUpCheckout(
env,
checkoutId
);


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


// Récupérer la référence
const reference =
checkout.checkout_reference ||
checkout.reference ||
"";


// Exemple :
// BORNE-001-fc26-20-123456

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


// Vérifications
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


// ========================
// LANCER LE JEU
// ========================

await fullyLoadURL(
env,
GAMES[jeu].url
);


console.log(
`Jeu ${jeu} lancé sur borne ${borne}`
);


// ========================
// RÉCUPÉRER LE TIMER
// ========================

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


// ========================
// DÉMARRER LE TIMER
// ========================

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

"Paiement confirmé - jeu lancé - timer démarré",

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


// ============================
// TEST FULLY
// ============================

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


// ============================
// TEST TIMER SANS PAIEMENT
// ============================

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

console.error(error);


return new Response(

`Erreur timer : ${error.message}`,

{
status: 500
}
);
}
}


// ============================
// ROUTE INCONNUE
// ============================

return new Response(
"Route inconnue",
{
status: 404
}
);
}
};
