// netlify/functions/create-booking.js
//
// Recibe los datos del formulario de reserva, calcula el total según la
// experiencia y N° de pasajeros, BLOQUEA automáticamente el horario en el
// Google Calendar de Loreto, y devuelve un link de pago.
//
// FASE ACTUAL: el pago es vía link de PayPal.me (manual de generar, pero
// automático de calcular). FASE 2 (roadmap): reemplazar por PayPal REST API
// (Orders API) + webhook que confirma el pago y envía el email automático.
//
// Requiere estas variables de entorno en Netlify:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY
//   GOOGLE_CALENDAR_ID
//   PAYPAL_ME_LINK   (ej: https://paypal.me/CollasuyoAstro)

const { google } = require('googleapis');

// Solo 3 experiencias reservables directamente en Stargazing with Loreto.
// Precios en USD — PLACEHOLDER: reemplazar por los valores reales que
// Loreto confirme (se están definiendo en paralelo en otro chat).
const PRICING = {
  relaxed:  { name: 'Relaxed',  price: 0, durationHours: 2.5 }, // TODO: precio USD real
  cultural: { name: 'Cultural', price: 0, durationHours: 4 },   // TODO: precio USD real
  wellness: { name: 'Wellness', price: 0, durationHours: 5 }    // TODO: precio USD real
};

const CURRENCY = 'USD';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const { name, email, phone, experience, passengers, date, startTime } = data;

    if (!name || !email || !experience || !passengers || !date || !startTime) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Faltan campos obligatorios.' })
      };
    }

    const exp = PRICING[experience];
    if (!exp) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Experiencia no válida.' })
      };
    }

    const numPassengers = parseInt(passengers, 10);
    const total = exp.price * numPassengers;

    // --- Autenticación con Google ---
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/calendar']
    );
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    // Hora de Chile continental (America/Santiago). Ajustar offset si cambia horario de verano.
    const start = new Date(`${date}T${startTime}:00`);
    const end = new Date(start.getTime() + exp.durationHours * 60 * 60 * 1000);

    // --- Bloquear el horario automáticamente en el calendario ---
    const insertRes = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `Reserva ${exp.name} — ${name} (${numPassengers}p) — PENDIENTE DE PAGO`,
        description:
          `Experiencia: ${exp.name}\n` +
          `Pasajeros: ${numPassengers}\n` +
          `Total: $${total.toLocaleString('en-US')} ${CURRENCY}\n` +
          `Email: ${email}\n` +
          `Teléfono: ${phone || '-'}\n` +
          `Estado: Reservado, esperando confirmación de pago.`,
        start: { dateTime: start.toISOString(), timeZone: 'America/Santiago' },
        end: { dateTime: end.toISOString(), timeZone: 'America/Santiago' },
        colorId: '5' // amarillo = pendiente de pago (puedes cambiar el color al confirmar el pago)
      }
    });

    const paypalBase = process.env.PAYPAL_ME_LINK || 'https://paypal.me/tunombre';
    const paypalLink = `${paypalBase}/${total}${CURRENCY}`;

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        eventId: insertRes.data.id,
        experience: exp.name,
        passengers: numPassengers,
        total,
        paypalLink
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
