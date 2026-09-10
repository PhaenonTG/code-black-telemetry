import { handleKandriveRequest } from "../../lib/kandriveRelay";

export const onRequest = ({ request }: { request: Request }) => handleKandriveRequest(request);
