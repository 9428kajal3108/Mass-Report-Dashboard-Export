/**
 * @description Exports selected Salesforce Dashboards as JPG images.
 *              Uses the Salesforce Analytics REST API to fetch dashboard
 *              screenshots and returns them as Base64-encoded strings for
 *              client-side download (individual or ZIP).
 *              Max 20 dashboards per call to stay within governor limits.
 * @group       MassReportExporter
 */
public with sharing class DashboardExportService {

    // ─── Inner DTOs ───────────────────────────────────────────────────────────

    /** A single exported image ready for client-side download. */
    public class ExportFile {
        @AuraEnabled public String name          { get; set; }
        @AuraEnabled public String base64Content { get; set; }
        @AuraEnabled public String mimeType      { get; set; }
    }

    /** Aggregated result of an export job. */
    public class ExportResult {
        @AuraEnabled public List<ExportFile> files         { get; set; }
        @AuraEnabled public Boolean          success       { get; set; }
        @AuraEnabled public String           errorMessage  { get; set; }
        @AuraEnabled public Integer          totalExported { get; set; }
        @AuraEnabled public Integer          totalFailed   { get; set; }

        public ExportResult() {
            this.files         = new List<ExportFile>();
            this.success       = true;
            this.errorMessage  = '';
            this.totalExported = 0;
            this.totalFailed   = 0;
        }
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    private static final Integer MAX_DASHBOARDS = 20;

    // ─── Public AuraEnabled Method ────────────────────────────────────────────

    /**
     * @description Exports the given Dashboard IDs as JPG images using the
     *              Salesforce Analytics REST API (printable view / image endpoint).
     *              Each dashboard becomes one ExportFile with mimeType image/jpeg.
     *
     * @param dashboardIds  List of Dashboard IDs (max 20)
     * @return              ExportResult with Base64-encoded JPG files
     */
    @AuraEnabled
    public static ExportResult exportDashboards(List<String> dashboardIds) {
        ExportResult result = new ExportResult();

        if (dashboardIds == null || dashboardIds.isEmpty()) {
            result.success      = false;
            result.errorMessage = 'No dashboards selected for export.';
            return result;
        }

        if (dashboardIds.size() > MAX_DASHBOARDS) {
            result.success      = false;
            result.errorMessage = 'Maximum ' + MAX_DASHBOARDS
                + ' dashboards can be exported at once. You selected '
                + dashboardIds.size() + '. Please reduce your selection.';
            return result;
        }

        // Fetch dashboard metadata for filenames (with sharing already enforced by class)
        Map<String, Dashboard> dashMap = new Map<String, Dashboard>();
        for (Dashboard d : [
            SELECT Id, Title, DeveloperName
            FROM Dashboard
            WHERE Id IN :dashboardIds
            WITH USER_MODE
        ]) {
            dashMap.put(d.Id, d);
        }

        String firstErrorMsg = '';
        String baseUrl = URL.getOrgDomainUrl().toExternalForm();

        for (String dashId : dashboardIds) {
            // Skip dashboards the user cannot access
            if (!dashMap.containsKey(dashId)) {
                result.totalFailed++;
                continue;
            }

            Dashboard d = dashMap.get(dashId);
            String rawName = String.isNotBlank(d.DeveloperName) ? d.DeveloperName : d.Title;
            String safeName = rawName.replaceAll('[^a-zA-Z0-9_]', '_');

            try {
                ExportFile file = fetchDashboardImage(baseUrl, dashId, safeName, d.Title);
                result.files.add(file);
                result.totalExported++;
            } catch (Exception ex) {
                result.totalFailed++;
                if (String.isBlank(firstErrorMsg)) {
                    firstErrorMsg = ex.getMessage();
                }

                // Add an error placeholder so the client knows which one failed
                ExportFile errFile    = new ExportFile();
                errFile.name          = 'ERROR_' + safeName + '.txt';
                errFile.mimeType      = 'text/plain';
                errFile.base64Content = EncodingUtil.base64Encode(
                    Blob.valueOf(
                        'Export failed for Dashboard: ' + d.Title + '\n'
                        + 'ID            : ' + dashId + '\n'
                        + 'Exception type: ' + ex.getTypeName() + '\n'
                        + 'Message       : ' + ex.getMessage() + '\n'
                        + 'Stack trace   : ' + ex.getStackTraceString()
                    )
                );
                result.files.add(errFile);
            }
        }

        if (result.totalFailed > 0 && result.totalExported == 0) {
            result.success      = false;
            result.errorMessage = 'All ' + result.totalFailed
                + ' dashboard(s) failed to export'
                + (String.isNotBlank(firstErrorMsg) ? ': ' + firstErrorMsg : '. Check error files in ZIP.');
        }

        return result;
    }

    // ─── Private: Image Fetch ─────────────────────────────────────────────────

    /**
     * Calls the Salesforce Analytics REST API to get a dashboard screenshot.
     * Endpoint: /services/data/vXX.0/analytics/dashboards/{id}?view=IMAGE
     *
     * If the image endpoint is unavailable (e.g. sandbox restrictions), falls back
     * to a descriptive placeholder so the ZIP is still useful.
     */
    private static String getApiSessionId() {
        if (Test.isRunningTest()) {
            return 'TEST_SESSION_ID';
        }
        try {
            PageReference pageRef = Page.SessionIdVF;
            String content = pageRef.getContent().toString();
            return content.substringBetween('Start_Of_Session_Id', 'End_Of_Session_Id');
        } catch (Exception ex) {
            // Fallback to UserInfo.getSessionId() if VF cannot be rendered
            return UserInfo.getSessionId();
        }
    }

    private static ExportFile fetchDashboardImage(
        String baseUrl,
        String dashId,
        String safeName,
        String dashTitle
    ) {
        String sessionId = getApiSessionId();
        String apiVersion = '61.0';

        // 1. Try standard Analytics Download API for PNG
        String endpoint = baseUrl + '/services/data/v' + apiVersion
            + '/analytics/download/dashboard/' + dashId + '.png';

        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + sessionId);
        req.setHeader('Accept', 'image/png,image/jpeg,*/*');
        req.setTimeout(120000);

        Http http = new Http();
        HttpResponse res = http.send(req);

        // 2. If 404, fall back to /analytics/dashboards/{id}?view=IMAGE
        if (res.getStatusCode() == 404) {
            endpoint = baseUrl + '/services/data/v' + apiVersion
                + '/analytics/dashboards/' + dashId + '?view=IMAGE';
            req = new HttpRequest();
            req.setEndpoint(endpoint);
            req.setMethod('GET');
            req.setHeader('Authorization', 'Bearer ' + sessionId);
            req.setHeader('Accept', 'image/jpeg,image/png,*/*');
            req.setTimeout(120000);
            res = http.send(req);
        }

        // Handle redirects if present
        if (res.getStatusCode() == 302 || res.getStatusCode() == 303) {
            String location = res.getHeader('Location');
            if (String.isNotBlank(location)) {
                HttpRequest req2 = new HttpRequest();
                req2.setEndpoint(location);
                req2.setMethod('GET');
                req2.setHeader('Authorization', 'Bearer ' + sessionId);
                req2.setTimeout(120000);
                res = http.send(req2);
            }
        }

        if (res.getStatusCode() == 200) {
            String contentType = res.getHeader('Content-Type');
            Boolean isPng = (contentType != null && contentType.containsIgnoreCase('png'));

            ExportFile file = new ExportFile();
            file.name          = safeName + (isPng ? '.png' : '.jpg');
            file.mimeType      = isPng ? 'image/png' : 'image/jpeg';
            file.base64Content = EncodingUtil.base64Encode(res.getBodyAsBlob());
            return file;
        } else {
            throw new DashboardExportException(
                'Dashboard image API returned HTTP ' + res.getStatusCode()
                + ': ' + res.getStatus()
                + '. Body: ' + res.getBody().abbreviate(500)
            );
        }
    }

    // ─── Custom Exception ─────────────────────────────────────────────────────

    public class DashboardExportException extends Exception {}
}
