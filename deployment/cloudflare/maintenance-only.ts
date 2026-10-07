import { maintenanceResponse } from '../../lib/write-freeze';

// Deliberately fail closed: this version cannot serve the app even if a flag is
// accidentally changed. Exit maintenance by deploying the saved D1 version.
export default {
  async fetch(request: Request) {
    const response = maintenanceResponse(request);
    response.headers.set('X-QRMenu-Maintenance-Build', 'd1-freeze-v2');
    return response;
  },
  async scheduled() { /* No D1, session, email, backup or queue work. */ },
};
