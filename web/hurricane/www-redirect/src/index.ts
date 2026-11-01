export default {
  fetch(request: Request): Response {
    const destination = new URL(request.url);
    destination.protocol = "https:";
    destination.hostname = "tropics.codeblackwx.com";
    destination.port = "";

    return Response.redirect(destination.toString(), 308);
  },
};
