/**
 * @description Exports selected Salesforce Reports to CSV or SpreadsheetML (Excel-compatible
 *              .xls) format using the Analytics Reports API. Returns files as Base64-encoded
 *              strings for client-side ZIP assembly (JSZip).
 *              Max 50 reports per synchronous call to stay within governor limits.
 * @group       MassReportExporter
 */
public with sharing class ReportExportService {

    // ─── Inner DTOs ───────────────────────────────────────────────────────────

    /** A single exported file ready for client-side download. */
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

    private static final Integer MAX_REPORTS  = 50;
    private static final String  FMT_CSV     = 'CSV';
    private static final String  FMT_EXCEL   = 'EXCEL';

    // ─── Public AuraEnabled Method ────────────────────────────────────────────

    /**
     * @description Exports the given Report IDs to the requested format.
     *              Each report becomes one ExportFile in the result.
     *              On per-report failure, adds an error text file and continues.
     *
     * @param reportIds  List of Report IDs (max 50)
     * @param format     'Excel' or 'CSV'
     * @return           ExportResult with Base64-encoded files
     */
    @AuraEnabled
    public static ExportResult exportReports(List<String> reportIds, String format) {
        ExportResult result = new ExportResult();

        if (reportIds == null || reportIds.isEmpty()) {
            result.success      = false;
            result.errorMessage = 'No reports selected for export.';
            return result;
        }

        if (reportIds.size() > MAX_REPORTS) {
            result.success      = false;
            result.errorMessage = 'Maximum ' + MAX_REPORTS
                + ' reports can be exported at once. You selected '
                + reportIds.size() + '. Please reduce your selection.';
            return result;
        }

        String fmt = String.isNotBlank(format)
            ? format.toUpperCase()
            : FMT_EXCEL;

        for (String reportId : reportIds) {
            try {
                ExportFile file = generateFile(reportId, fmt);
                result.files.add(file);
                result.totalExported++;
            } catch (Exception ex) {
                result.totalFailed++;
                // Add an error marker file so the user knows which one failed
                ExportFile errFile  = new ExportFile();
                errFile.name        = 'ERROR_' + reportId + '.txt';
                errFile.mimeType    = 'text/plain';
                errFile.base64Content = EncodingUtil.base64Encode(
                    Blob.valueOf('Export failed for Report ID ' + reportId
                        + '\nReason: ' + ex.getMessage())
                );
                result.files.add(errFile);
            }
        }

        if (result.totalFailed > 0 && result.totalExported == 0) {
            result.success      = false;
            result.errorMessage = 'All ' + result.totalFailed
                + ' report(s) failed to export. Check error files in the ZIP.';
        }

        return result;
    }

    // ─── Private: File Generation ─────────────────────────────────────────────

    private static ExportFile generateFile(String reportId, String fmt) {
        // Fetch report metadata from database for the filename
        Report reportRecord = [
            SELECT Id, Name, DeveloperName FROM Report WHERE Id = :reportId LIMIT 1
        ];
        // Safe filename: only alphanumeric + underscore
        String safeName = reportRecord.DeveloperName
            .replaceAll('[^a-zA-Z0-9_]', '_');

        // Run report via Analytics API
        Reports.ReportResults rr = Reports.ReportManager.runReport(reportId, true);
        Reports.ReportMetadata meta = rr.getReportMetadata();
        List<String> columns       = meta.getDetailColumns();
        Map<String, Reports.ReportTypeColumn> colMap =
            rr.getReportTypeMetadata().getColumns();

        // Build header labels
        List<String> headers = new List<String>();
        for (String colKey : columns) {
            Reports.ReportTypeColumn col = colMap.get(colKey);
            headers.add(col != null ? col.getLabel() : colKey);
        }

        // Build data rows
        List<List<String>> rows = new List<List<String>>();
        try {
            Reports.ReportFactWithDetails fact =
                (Reports.ReportFactWithDetails) rr.getFactMap().get('T!T');
            if (fact != null) {
                for (Reports.ReportDetailRow row : fact.getRows()) {
                    List<String> rowData = new List<String>();
                    for (Reports.ReportDataCell cell : row.getDataCells()) {
                        rowData.add(cell.getLabel() != null ? cell.getLabel() : '');
                    }
                    rows.add(rowData);
                }
            }
        } catch (Exception e) {
            // Summary/Matrix reports: fact map key differs; add a note row
            rows.add(new List<String>{
                'Note: This report type does not support detail row export via API.'
            });
        }

        ExportFile file = new ExportFile();
        if (fmt == FMT_CSV) {
            file.name         = safeName + '.csv';
            file.mimeType     = 'text/csv';
            file.base64Content = EncodingUtil.base64Encode(
                Blob.valueOf(buildCSV(headers, rows))
            );
        } else {
            file.name         = safeName + '.xls';
            file.mimeType     = 'application/vnd.ms-excel';
            file.base64Content = EncodingUtil.base64Encode(
                Blob.valueOf(buildSpreadsheetML(reportRecord.Name, headers, rows))
            );
        }
        return file;
    }

    // ─── Private: CSV Builder ─────────────────────────────────────────────────

    private static String buildCSV(List<String> headers, List<List<String>> rows) {
        List<String> lines = new List<String>();
        lines.add(csvRow(headers));
        for (List<String> row : rows) { lines.add(csvRow(row)); }
        return String.join(lines, '\r\n');
    }

    private static String csvRow(List<String> cells) {
        List<String> escaped = new List<String>();
        for (String cell : cells) {
            String safe = (cell != null) ? cell.replace('"', '""') : '';
            escaped.add('"' + safe + '"');
        }
        return String.join(escaped, ',');
    }

    // ─── Private: SpreadsheetML (Excel) Builder ───────────────────────────────

    /**
     * Generates a SpreadsheetML XML document (.xls) — a single XML file that
     * Excel and LibreOffice open natively. No ZIP required on the server side.
     * Styled with a branded header row (blue background, white bold text).
     */
    private static String buildSpreadsheetML(
        String sheetName,
        List<String> headers,
        List<List<String>> rows
    ) {
        // Clamp sheet name to Excel 31-char limit and sanitise for XML
        String safeSheet = xmlEncode(
            sheetName.length() > 31 ? sheetName.left(31) : sheetName
        );

        List<String> xml = new List<String>();
        xml.add('<?xml version="1.0" encoding="UTF-8"?>');
        xml.add('<?mso-application progid="Excel.Sheet"?>');
        xml.add('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
        xml.add('  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"');
        xml.add('  xmlns:x="urn:schemas-microsoft-com:office:excel">');
        // Styles
        xml.add('  <Styles>');
        xml.add('    <Style ss:ID="H">');
        xml.add('      <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="11"/>');
        xml.add('      <Interior ss:Color="#1B57C2" ss:Pattern="Solid"/>');
        xml.add('      <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>');
        xml.add('    </Style>');
        xml.add('    <Style ss:ID="D">');
        xml.add('      <Alignment ss:Vertical="Top" ss:WrapText="0"/>');
        xml.add('    </Style>');
        xml.add('  </Styles>');
        // Worksheet
        xml.add('  <Worksheet ss:Name="' + safeSheet + '">');
        xml.add('    <Table ss:DefaultColumnWidth="120">');

        // Header row
        xml.add('      <Row ss:Height="22">');
        for (String h : headers) {
            xml.add('        <Cell ss:StyleID="H"><Data ss:Type="String">'
                + xmlEncode(h) + '</Data></Cell>');
        }
        xml.add('      </Row>');

        // Data rows
        for (List<String> row : rows) {
            xml.add('      <Row>');
            for (String cell : row) {
                xml.add('        <Cell ss:StyleID="D"><Data ss:Type="String">'
                    + xmlEncode(cell != null ? cell : '') + '</Data></Cell>');
            }
            xml.add('      </Row>');
        }

        xml.add('    </Table>');
        xml.add('  </Worksheet>');
        xml.add('</Workbook>');
        return String.join(xml, '\n');
    }

    private static String xmlEncode(String input) {
        if (String.isBlank(input)) { return ''; }
        return input
            .replace('&',  '&amp;')
            .replace('<',  '&lt;')
            .replace('>',  '&gt;')
            .replace('"',  '&quot;')
            .replace('\'', '&apos;');
    }
}
