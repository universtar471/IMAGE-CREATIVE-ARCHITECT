# gateway-empty-answer

Goal: a live HHTECH run failed after 600 s with "HHTECH answered without an image." The gateway sends 200 headers and keep-alive newlines immediately, so a late failure arrives as an error object inside a 200 body, which the adapter did not quote.

Done: `wire::no_image_message` quotes the gateway message (key redacted) or says the image list was empty. Test `a_200_without_an_image_quotes_what_the_gateway_said`.

Open: the actual late-failure body was not captured (a rerun with curl succeeded in 169 s).

Test: `npm run verify`.
