import { DurableObject } from "cloudflare:workers";

const FULLY_API_URL = "https://api.fully-kiosk.com/remote/";

const QR_URL =
"https://testsrcodejeux.carrd.co/?borne=001";

const GAMES = {
fc26: {
url:
"https://www.xbox.com/fr-FR/play/launch/ea-sports-fc-26-pour-xbox-series-x%7Cs/9P9FTXPKQ35P"
}
};

const PRICES = {
20: 1,
40: 2,
60: 3,
90: 4,
120: 5
};


// ======================================================
// FULLY CLOUD
// ======================================================

async function fullyCommand(env, command, parameters = {}) {

if (!env.FULLY_EMAIL) {
throw new Error("FULLY_EMAIL manquant");
}

if (!env.FULLY_API_KEY) {
throw new Error("FULLY_API_KEY manquant");
}

if (!env.FULLY_DEVICE_ID) {
throw new Error("FULLY_DEVICE_ID manquant");
}

const apiUrl = new URL(FULLY_API_URL);

apiUrl.searchParams.set(
"apiemail",
env.FULLY_EMAIL
);

apiUrl.searchParams.set(
"apikey",
env.FULLY_API_KEY
);

apiUrl.searchParams.set(
"devid",
env.FULLY_DEVICE_ID
);

apiUrl.searchParams.set(
"cmd",
command
);

// Important :
// on attend la vraie réponse de Fully
apiUrl.searchParams.set(
"nowait",
"0"
);

for (const [key, value] of Object.entries(parameters)) {

apiUrl.searchParams.set(
key,
String(value)
);
}

console.log(
"FULLY COMMAND :",
command
);

const response = await fetch(
apiUrl.toString(),
{
method: "GET"
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
`Fully HTTP ${response.status}`
);
}

// Fully peut retourner une erreur applicative
// même avec HTTP 200.
if (
text.includes('"status":"Error"') ||
text.includes('"status": "Error"')
) {

throw new Error(
`Fully a refusé la commande : ${text}`
);
}

return text;
}


// ======================================================
// CHARGER UNE URL SUR LE FIRE STICK
// ======================================================

async function fullyLoadURL(env, targetURL) {

return await fullyCommand(
env,
"loadURL",
{
url: targetURL
}
);
}


// ======================================================
// SUMUP - CREATION DU CHECKOUT
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
Authorization:
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
`SumUp create HTTP ${response.status}`
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
// SUMUP - VERIFICATION
// ======================================================

async function getSumUpCheckout(
env,
checkoutId
) {

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

const data =
await response.json();

console.log(
"SUMUP VERIFY RESPONSE :",
JSON.stringify(data)
);

if (!response.ok) {

throw new Error(
`SumUp verify HTTP ${response.status}`
);
}

return data;
}


// ======================================================
// DURABLE OBJECT
// ======================================================

export class SessionTimer extends DurableObject {

async fetch(request) {

const url = new URL(request.url);

// ----------------------------------------------
// DEMARRER LE TIMER
// ----------------------------------------------

if (url.pathname === "/start") {

const duree =
Number(url.searchParams.get("duree"));

if (!duree || duree <= 0) {
return new Response(
"Durée invalide",
{ status: 400 }
);
}

await this.ctx.storage.setAlarm(
Date.now() + duree * 60 * 1000
);

console.log(
`TIMER START : ${duree} minutes`
);

return new Response(
`Timer démarré pour ${duree} minutes`
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
// WORKER
// ======================================================

export default {

async fetch(request, env) {

const url =
new URL(request.url);


// ==================================================
// TEST FULLY
// ==================================================

if (
url.pathname === "/test-google"
) {

try {

const result =
await fullyLoadURL(
env,
"https://www.google.com"
);

return new Response(
"Google envoyé au Fire Stick.\n\n" +
result
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

if (
url.pathname === "/test-fully"
) {

try {

const result =
await fullyLoadURL(
env,
GAMES.fc26.url
);

return new Response(
"FC26 envoyé au Fire Stick.\n\n" +
result
);

} catch (error) {

console.error(
"TEST FC26 ERROR :",
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


// ==================================================
// HOME
// ==================================================

if (
url.pathname === "/"
) {

return new Response(
"BORNE GAMING OK"
);
}


// ==================================================
// PAIEMENT TEST
// ==================================================

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


// ==================================================
// CREATION PAIEMENT
// ==================================================

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


console.log(
"CREATION CHECKOUT :",
reference
);


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


// ==================================================
// WEBHOOK SUMUP
// ==================================================

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

// Rien à faire
}


const checkoutId =

url.searchParams.get(
"checkout_id"
)

||

url.searchParams.get(
"id"
)

||

body.checkout_id

||

body.id

||

body.payload?.checkout_id

||

body.payload?.id

||

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
"Paiement non confirmé"
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


console.log(
"BORNE :",
borne
);

console.log(
"JEU :",
jeu
);

console.log(
"DUREE :",
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


// ----------------------------------------------
// LANCEMENT JEU
// ----------------------------------------------

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


// ----------------------------------------------
// TIMER
// ----------------------------------------------

const timer =
env.SESSION_TIMER.getByName(
`borne-${borne}`
);


await timer.fetch(
`https://session/start?duree=${duree}`,
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
