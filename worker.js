import { DurableObject } from "cloudflare:workers";

// ======================================================
// CONFIGURATION
// ======================================================

const FULLY_API_URL = "https://api.fully-kiosk.com/remote/";

const QR_URL =
"https://testsrcodejeux.carrd.co/?borne=001";

const SHADOW_PACKAGE = "com.blade.shadowcloudgaming";

const PRICES = {
20: 1,
40: 2,
60: 3,
90: 4,
120: 5
};

const WORKER_URL =
"https://borne-gaming.eloprati60.workers.dev";

// ======================================================
// COMMANDES FULLY KIOSK
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

apiUrl.searchParams.set("apiemail", env.FULLY_EMAIL);
apiUrl.searchParams.set("apikey", env.FULLY_API_KEY);
apiUrl.searchParams.set("devid", env.FULLY_DEVICE_ID);
apiUrl.searchParams.set("cmd", command);
apiUrl.searchParams.set("nowait", "0");

for (const [key, value] of Object.entries(parameters)) {
apiUrl.searchParams.set(key, String(value));
}

const response = await fetch(apiUrl.toString());
const text = await response.text();

console.log("FULLY COMMAND:", command);
console.log("FULLY RESPONSE:", text);

if (!response.ok) {
throw new Error(`Fully HTTP ${response.status}`);
}

if (
text.includes('"status":"Error"') ||
text.includes('"status": "Error"')
) {
throw new Error(`Fully a refusé la commande : ${text}`);
}

return text;
}

// ======================================================
// OUVRIR UNE URL SUR LE FIRE TV STICK
// ======================================================

async function fullyLoadURL(env, targetURL) {
return fullyCommand(env, "loadURL", {
url: targetURL
});
}

// ======================================================
// LANCER SHADOW PC
// ======================================================

async function launchShadow(env) {
return fullyCommand(env, "startApplication", {
package: SHADOW_PACKAGE
});
}

// ======================================================
// SUMUP : CRÉER UN PAIEMENT
// ======================================================

async function createSumUpCheckout(env, amount, reference) {
if (!env.SUMUP_API_KEY) {
throw new Error("SUMUP_API_KEY manquant");
}

if (!env.SUMUP_MERCHANT_CODE) {
throw new Error("SUMUP_MERCHANT_CODE manquant");
}

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
return_url: `${WORKER_URL}/payment-return`
})
}
);

const data = await response.json();

console.log("SUMUP CREATE:", JSON.stringify(data));

if (!response.ok) {
throw new Error(
`Création SumUp impossible : HTTP ${response.status} ${JSON.stringify(data)}`
);
}

if (!data.hosted_checkout_url) {
throw new Error("URL de paiement SumUp absente");
}

return data;
}

// ======================================================
// SUMUP : VÉRIFIER LE PAIEMENT
// ======================================================

async function getSumUpCheckout(env, checkoutId) {
const response = await fetch(
`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`,
{
headers: {
Authorization: `Bearer ${env.SUMUP_API_KEY}`
}
}
);

const data = await response.json();

if (!response.ok) {
throw new Error(
`Vérification SumUp impossible : HTTP ${response.status}`
);
}

return data;
}

// ======================================================
// MINUTEUR DURABLE OBJECT
// ======================================================

export class SessionTimer extends DurableObject {
async fetch(request) {
const url = new URL(request.url);

if (url.pathname === "/start") {
const duree = Number(url.searchParams.get("duree"));

if (!Number.isInteger(duree) || !PRICES[duree]) {
return new Response("Durée invalide", {
status: 400
});
}

const fin = Date.now() + duree * 60 * 1000;

await this.ctx.storage.put("fin", fin);
await this.ctx.storage.setAlarm(fin);

console.log(`MINUTEUR DÉMARRÉ : ${duree} minutes`);

return new Response(`Minuteur démarré : ${duree} minutes`);
}

if (url.pathname === "/cancel") {
await this.ctx.storage.deleteAlarm();
await this.ctx.storage.delete("fin");

return new Response("Minuteur annulé");
}

if (url.pathname === "/status") {
const fin = await this.ctx.storage.get("fin");

return Response.json({
fin: fin || null,
restantMs: fin ? Math.max(0, fin - Date.now()) : 0
});
}

return new Response("SessionTimer OK");
}

async alarm() {
console.log("FIN DE SESSION : retour QR demandé");

try {
await fullyLoadURL(this.env, QR_URL);
console.log("Retour QR envoyé à Fully Kiosk");
} catch (error) {
console.error("ERREUR RETOUR QR :", error.message);
}

await this.ctx.storage.delete("fin");
}
}

// ======================================================
// WORKER HTTP
// ======================================================

export default {
async fetch(request, env) {
const url = new URL(request.url);

// --------------------------------------------------
// ACCUEIL
// --------------------------------------------------

if (url.pathname === "/") {
return new Response("BORNE GAMING OK");
}

// --------------------------------------------------
// TEST GOOGLE
// --------------------------------------------------

if (url.pathname === "/test-google") {
try {
const result = await fullyLoadURL(
env,
"https://www.google.com"
);

return new Response("Google envoyé.\n" + result);
} catch (error) {
return new Response("Erreur : " + error.message, {
status: 500
});
}
}

// --------------------------------------------------
// TEST SHADOW
// --------------------------------------------------

if (url.pathname === "/test-shadow") {
try {
const result = await launchShadow(env);

return new Response(
"Commande de lancement Shadow envoyée.\n" + result
);
} catch (error) {
return new Response(
"Erreur lancement Shadow : " + error.message,
{ status: 500 }
);
}
}

// --------------------------------------------------
// TEST RETOUR QR
// --------------------------------------------------

if (url.pathname === "/test-qr") {
try {
const result = await fullyLoadURL(env, QR_URL);

return new Response("Commande retour QR envoyée.\n" + result);
} catch (error) {
return new Response("Erreur : " + error.message, {
status: 500
});
}
}

// --------------------------------------------------
// TEST MINUTEUR
// Exemple : /test-timer?borne=001&duree=1
// --------------------------------------------------

if (url.pathname === "/test-timer") {
try {
const borne = url.searchParams.get("borne") || "001";
const duree = Number(url.searchParams.get("duree") || 1);

if (!Number.isInteger(duree) || !PRICES[duree]) {
return new Response(
"Durée de test invalide. Choisis 20, 40, 60, 90 ou 120.",
{ status: 400 }
);
}

const timer = env.SESSION_TIMER.getByName(`borne-${borne}`);

const result = await timer.fetch(
`https://session/start?duree=${duree}`,
{ method: "POST" }
);

return new Response(await result.text());
} catch (error) {
return new Response("Erreur minuteur : " + error.message, {
status: 500
});
}
}

// --------------------------------------------------
// ÉTAT DU MINUTEUR
// Exemple : /timer-status?borne=001
// --------------------------------------------------

if (url.pathname === "/timer-status") {
const borne = url.searchParams.get("borne") || "001";
const timer = env.SESSION_TIMER.getByName(`borne-${borne}`);

return timer.fetch("https://session/status");
}

// --------------------------------------------------
// TEST PAIEMENT SUMUP
// --------------------------------------------------

if (url.pathname === "/paiement-test") {
try {
const checkout = await createSumUpCheckout(
env,
1,
`TEST-${Date.now()}`
);

return Response.redirect(
checkout.hosted_checkout_url,
303
);
} catch (error) {
return new Response(
"Erreur paiement test : " + error.message,
{ status: 500 }
);
}
}
 // TEST GRATUIT : lancer Shadow pendant 2 minutes
    if (url.pathname === "/test-gratuit") {
      try {
        // Lancer Shadow sur la Fire TV
        await fullyCommand(env, "startApplication", {
          package: SHADOW_PACKAGE
        });

        // Démarrer le minuteur de test de 2 minutes
        const timer = env.SESSION_TIMER.getByName("borne-001");

        const timerResponse = await timer.fetch(
          "https://session/start?duree=20",
          { method: "POST" }
        );

        if (!timerResponse.ok) {
          throw new Error(await timerResponse.text());
        }

        return new Response(
          "Test gratuit lancé : Shadow démarré, minuteur de 20 minutes."
        );
      } catch (error) {
        console.error("ERREUR TEST GRATUIT :", error.message);

        return new Response(
          `Échec du test : ${error.message}`,
          { status: 500 }
        );
      }
    }

// --------------------------------------------------
// CRÉATION DU PAIEMENT
// Exemple : /pay?borne=001&duree=20
// --------------------------------------------------

if (url.pathname === "/pay") {
try {
const borne = url.searchParams.get("borne") || "001";
const duree = Number(url.searchParams.get("duree"));

if (!/^[a-zA-Z0-9]+$/.test(borne)) {
return new Response("Identifiant de borne invalide", {
status: 400
});
}

if (!PRICES[duree]) {
return new Response(
"Durée invalide. Choisis 20, 40, 60, 90 ou 120 minutes.",
{ status: 400 }
);
}

const reference =
`BORNE-${borne}-shadow-${duree}-${Date.now()}`;

const checkout = await createSumUpCheckout(
env,
PRICES[duree],
reference
);

return Response.redirect(
checkout.hosted_checkout_url,
303
);
} catch (error) {
console.error("PAY ERROR:", error);

return new Response(
"Erreur paiement : " + error.message,
{ status: 500 }
);
}
}

// --------------------------------------------------
// RETOUR NAVIGATEUR APRÈS PAIEMENT
// Ce retour seul ne prouve PAS que le paiement est payé.
// --------------------------------------------------

if (url.pathname === "/payment-return") {
return new Response(
`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paiement</title>
<style>
body{font-family:Arial;text-align:center;padding:30px;background:#111;color:white}
</style>
</head>
<body>
<h1>Merci !</h1>
<p>La vérification du paiement est en cours.</p>
<p>Vous pouvez retourner à la borne.</p>
</body>
</html>`,
{
headers: {
"Content-Type": "text/html; charset=UTF-8"
}
}
);
}

// --------------------------------------------------
// WEBHOOK SUMUP
// Vérifie le statut réel auprès de SumUp.
// --------------------------------------------------

if (url.pathname === "/webhook") {
try {
let body = {};

try {
body = await request.json();
} catch {
// Le webhook peut ne pas contenir de JSON.
}

const checkoutId =
url.searchParams.get("checkout_id") ||
url.searchParams.get("id") ||
body.checkout_id ||
body.id ||
body.payload?.checkout_id ||
body.payload?.id;

if (!checkoutId) {
return new Response("Checkout ID absent", {
status: 400
});
}

const checkout = await getSumUpCheckout(env, checkoutId);

const status = String(checkout.status || "").toUpperCase();

if (status !== "PAID") {
return new Response("Paiement non confirmé");
}

const reference =
checkout.checkout_reference ||
checkout.reference ||
body.checkout_reference ||
"";

const match = reference.match(
/^BORNE-([^-]+)-shadow-(\d+)-/
);

if (!match) {
return new Response("Référence de paiement invalide", {
status: 400
});
}

const borne = match[1];
const duree = Number(match[2]);

if (!PRICES[duree]) {
return new Response("Durée invalide", {
status: 400
});
}

console.log(
"PAIEMENT CONFIRMÉ",
reference,
"BORNE",
borne,
"DURÉE",
duree
);

// Lancer Shadow après vérification du statut payé.
await launchShadow(env);

// Démarrer le minuteur de la borne.
const timer = env.SESSION_TIMER.getByName(`borne-${borne}`);

const timerResponse = await timer.fetch(
`https://session/start?duree=${duree}`,
{ method: "POST" }
);

if (!timerResponse.ok) {
throw new Error("Le minuteur n'a pas démarré");
}

return new Response(
`Paiement confirmé. Lancement de Shadow demandé pour ${duree} minutes.`
);
} catch (error) {
console.error("WEBHOOK ERROR:", error);

return new Response(
"Erreur webhook : " + error.message,
{ status: 500 }
);
}
}

return new Response("Route inconnue", {
status: 404
});
}
};
