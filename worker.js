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

const QR_PAGE =
"https://testsrcodejeux.carrd.co/?borne=001";

const FC26_URL =
"https://www.xbox.com/fr-FR/play/launch/ea-sports-fc-26-pour-xbox-series-x%7Cs/9P9FTXPKQ35P";

const FULLY_API_URL =
"https://api.fully-kiosk.com/remote/";

// ======================================================
// DURABLE OBJECT : MINUTEUR
// ======================================================

export class SessionTimer extends DurableObject {

async startSession() {

// 20 minutes = 1 200 000 millisecondes
const endTime =
Date.now() + 20 * 60 * 1000;

await this.ctx.storage.put(
"sessionEnd",
endTime
);

await this.ctx.storage.setAlarm(
endTime
);

return "Minuteur 20 minutes lancé";
}

async alarm() {

const endTime =
await this.ctx.storage.get("sessionEnd");

if (!endTime) {
return;
}

// Si l'alarme arrive trop tôt,
// on la reprogramme.
if (Date.now() < endTime) {

await this.ctx.storage.setAlarm(
endTime
);

return;
}

// ==============================================
// RETOUR À LA PAGE QR
// ==============================================

const fullyUrl =
new URL(FULLY_API_URL);

fullyUrl.searchParams.set(
"apiemail",
this.env.FULLY_EMAIL
);

fullyUrl.searchParams.set(
"apikey",
this.env.FULLY_API_KEY
);

fullyUrl.searchParams.set(
"devid",
this.env.FULLY_DEVICE_ID
);

fullyUrl.searchParams.set(
"cmd",
"loadURL"
);

fullyUrl.searchParams.set(
"url",
QR_PAGE
);

const response =
await fetch(
fullyUrl.toString()
);

console.log(
"Fin session - retour QR : " +
response.status
);

// Nettoyage
await this.ctx.storage.delete(
"sessionEnd"
);
}
}


// ======================================================
// WORKER PRINCIPAL
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
"BORNE GAMING OK"
);
}


// ==================================================
// TEST SUMUP 1 €
// ==================================================

if (
url.pathname === "/paiement-test" &&
request.method === "GET"
) {

const reference =
"borne001-test-1euro-" +
Date.now();

const sumupResponse =
await fetch(
"https://api.sumup.com/v0.1/checkouts",
{
method: "POST",

headers: {
"Authorization":
"Bearer " +
env.SUMUP_API_KEY,

"Content-Type":
"application/json"
},

body: JSON.stringify({

checkout_reference:
reference,

amount:
1.00,

currency:
"EUR",

merchant_code:
env.SUMUP_MERCHANT_CODE,

description:
"TEST - Borne 001 - 1 euro",

hosted_checkout: {
enabled: true
},

return_url:
"https://borne-gaming.eloprati60.workers.dev/webhook"
})
}
);

const result =
await sumupResponse.text();

if (!sumupResponse.ok) {

return new Response(
result,
{
status:
sumupResponse.status,

headers: {
"Content-Type":
"application/json"
}
}
);
}

const checkout =
JSON.parse(result);

return Response.redirect(
checkout.hosted_checkout_url,
302
);
}


// ==================================================
// VRAI PAIEMENT
// ==================================================

if (
url.pathname === "/pay" &&
request.method === "GET"
) {

const borne =
url.searchParams.get("borne");

const jeu =
url.searchParams.get("jeu");

const duree =
url.searchParams.get("duree");


if (
!borne ||
!jeu ||
!duree
) {

return new Response(
"Paramètres manquants : borne, jeu, duree",
{ status: 400 }
);
}


if (borne !== "001") {

return new Response(
"Borne inconnue",
{ status: 400 }
);
}


if (jeu !== "fc26") {

return new Response(
"Jeu non disponible",
{ status: 400 }
);
}


// Pour le moment :
// UNIQUEMENT 20 MINUTES

if (duree !== "20") {

return new Response(
"Pour le moment seule la durée 20 minutes est disponible.",
{ status: 400 }
);
}


const amount =
3.00;


const reference =
`borne${borne}-${jeu}-${duree}min-${Date.now()}`;


const sumupResponse =
await fetch(
"https://api.sumup.com/v0.1/checkouts",
{
method: "POST",

headers: {
"Authorization":
"Bearer " +
env.SUMUP_API_KEY,

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

description:
`Borne ${borne} - FC26 - 20 min`,

hosted_checkout: {
enabled: true
},

return_url:
"https://borne-gaming.eloprati60.workers.dev/webhook"
})
}
);


const result =
await sumupResponse.text();


if (!sumupResponse.ok) {

return new Response(
result,
{
status:
sumupResponse.status,

headers: {
"Content-Type":
"application/json"
}
}
);
}


const checkout =
JSON.parse(result);


return Response.redirect(
checkout.hosted_checkout_url,
302
);
}


// ==================================================
// WEBHOOK SUMUP
// ==================================================

if (
url.pathname === "/webhook" &&
request.method === "POST"
) {

try {

const data =
await request.json();


console.log(
"Webhook SumUp reçu"
);


if (
data.event_type &&
data.event_type !==
"CHECKOUT_STATUS_CHANGED"
) {

return new Response(
null,
{ status: 204 }
);
}


const checkoutId =
data.id;


if (!checkoutId) {

console.log(
"Webhook sans ID de checkout"
);

return new Response(
null,
{ status: 204 }
);
}


// ==========================================
// VÉRIFICATION DU PAIEMENT CHEZ SUMUP
// ==========================================

const checkoutResponse =
await fetch(
`https://api.sumup.com/v0.1/checkouts/${checkoutId}`,
{
method: "GET",

headers: {
"Authorization":
"Bearer " +
env.SUMUP_API_KEY
}
}
);


const checkoutText =
await checkoutResponse.text();


if (!checkoutResponse.ok) {

console.log(
"Erreur vérification checkout SumUp"
);

return new Response(
null,
{ status: 500 }
);
}


const checkout =
JSON.parse(checkoutText);


if (
checkout.status !== "PAID"
) {

console.log(
"Paiement non confirmé : " +
checkout.status
);

return new Response(
null,
{ status: 204 }
);
}


console.log(
"PAIEMENT CONFIRME"
);


// ==========================================
// RÉCUPÉRATION DES INFOS
// ==========================================

const reference =
checkout.checkout_reference || "";


const match =
reference.match(
/^borne(\d+)-([a-z0-9]+)-(\d+)min-(\d+)$/
);


if (!match) {

console.log(
"Référence inconnue"
);

return new Response(
null,
{ status: 204 }
);
}


const borne =
match[1];

const jeu =
match[2];

const duree =
match[3];


if (borne !== "001") {

return new Response(
null,
{ status: 204 }
);
}


if (jeu !== "fc26") {

return new Response(
null,
{ status: 204 }
);
}


if (duree !== "20") {

return new Response(
null,
{ status: 204 }
);
}


// ==========================================
// LANCEMENT FC26
// ==========================================

const fullyUrl =
new URL(FULLY_API_URL);


fullyUrl.searchParams.set(
"apiemail",
env.FULLY_EMAIL
);


fullyUrl.searchParams.set(
"apikey",
env.FULLY_API_KEY
);


fullyUrl.searchParams.set(
"devid",
env.FULLY_DEVICE_ID
);


fullyUrl.searchParams.set(
"cmd",
"loadURL"
);


fullyUrl.searchParams.set(
"url",
FC26_URL
);


const fullyResponse =
await fetch(
fullyUrl.toString()
);


console.log(
"FC26 envoyé à la borne " +
borne +
" : " +
fullyResponse.status
);


if (!fullyResponse.ok) {

return new Response(
null,
{ status: 500 }
);
}


// ==========================================
// LANCEMENT DU MINUTEUR 20 MIN
// ==========================================

const timer =
env.SESSION_TIMER.getByName(
"borne-" + borne
);


await timer.fetch(
"https://session/start"
);


console.log(
"Minuteur 20 minutes lancé"
);


return new Response(
null,
{ status: 204 }
);


} catch (error) {

console.log(
"Erreur webhook : " +
error.message
);

return new Response(
null,
{ status: 500 }
);
}
}


// ==================================================
// TEST DIRECT FULLY
// ==================================================

if (
url.pathname === "/test-fully" &&
request.method === "GET"
) {

const fullyUrl =
new URL(FULLY_API_URL);


fullyUrl.searchParams.set(
"apiemail",
env.FULLY_EMAIL
);


fullyUrl.searchParams.set(
"apikey",
env.FULLY_API_KEY
);


fullyUrl.searchParams.set(
"devid",
env.FULLY_DEVICE_ID
);


fullyUrl.searchParams.set(
"cmd",
"loadURL"
);


fullyUrl.searchParams.set(
"url",
FC26_URL
);


const response =
await fetch(
fullyUrl.toString()
);


const result =
await response.text();


return new Response(
result,
{
status:
response.status,

headers: {
"Content-Type":
"text/plain"
}
}
);
}


return new Response(
"Route inconnue",
{ status: 404 }
);
}
};
