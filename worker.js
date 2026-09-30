export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Meta webhook verification
    if (request.method === "GET" && url.pathname === "/webhook") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (mode === "subscribe" && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }

      return new Response("Forbidden", { status: 403 });
    }

    // Messenger webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      const body = await request.json();

      if (body.object !== "page") {
        return new Response("Not a Page event", { status: 404 });
      }

      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (!event.message || event.message.is_echo) continue;

          const senderId = event.sender?.id;
          const text = event.message?.text;

          if (!senderId || !text) continue;

          // Temporary reply for testing
          await sendMessengerMessage(
            senderId,
            "আপনার মেসেজ পেয়েছি। 😊"
            ,
            env.PAGE_ACCESS_TOKEN
          );
        }
      }

      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    return new Response("Messenger Assistant is running.", {
      status: 200
    });
  }
};

async function sendMessengerMessage(recipientId, message, pageToken) {
  const response = await fetch(
    "https://graph.facebook.com/v23.0/me/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: {
          id: recipientId
        },
        message: {
          text: message
        },
        access_token: pageToken
      })
    }
  );

  if (!response.ok) {
    console.error(await response.text());
  }
          }
