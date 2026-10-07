/**
 * @description Unit tests for ReportExportService.
 *              Validates guard conditions. Full export flow requires a real
 *              Report in the org (Reports.ReportManager.runReport is not mockable).
 */
@IsTest
private class ReportExportServiceTest {

    @IsTest
    static void testExportReports_NullIds_ReturnsFalse() {
        Test.startTest();
        ReportExportService.ExportResult result =
            ReportExportService.exportReports(null, 'CSV');
        Test.stopTest();

        System.assertEquals(false, result.success);
        System.assert(result.errorMessage.contains('No reports selected'));
    }

    @IsTest
    static void testExportReports_EmptyIds_ReturnsFalse() {
        Test.startTest();
        ReportExportService.ExportResult result =
            ReportExportService.exportReports(new List<String>(), 'Excel');
        Test.stopTest();

        System.assertEquals(false, result.success);
    }

    @IsTest
    static void testExportReports_ExceedsMaxReports_ReturnsFalse() {
        List<String> ids = new List<String>();
        for (Integer i = 0; i < 51; i++) {
            ids.add('000000000000001');
        }
        Test.startTest();
        ReportExportService.ExportResult result =
            ReportExportService.exportReports(ids, 'CSV');
        Test.stopTest();

        System.assertEquals(false, result.success);
        System.assert(result.errorMessage.contains('Maximum'));
    }

    @IsTest
    static void testExportReports_InvalidReportId_AddsErrorFile() {
        Test.startTest();
        // Fake ID that passes size check but will fail query
        ReportExportService.ExportResult result =
            ReportExportService.exportReports(
                new List<String>{ '000000000000001' }, 'CSV'
            );
        Test.stopTest();

        // Should still return files list with an error marker file
        System.assertNotEquals(null, result.files);
        System.assertEquals(1, result.files.size());
        System.assert(result.files[0].name.startsWith('ERROR_'),
            'Expected error marker file.');
    }

    @IsTest
    static void testBuildCSV_EscapesCellsAndIncludesRows() {
        String csv = ReportExportService.buildCSV(
            new List<String>{ 'Name', 'Notes' },
            new List<List<String>>{
                new List<String>{ 'Report', 'Said "hello"' },
                new List<String>{ null, 'Next row' }
            }
        );

        System.assertEquals(
            '"Name","Notes"\r\n"Report","Said ""hello"""\r\n"","Next row"',
            csv
        );
    }

    @IsTest
    static void testBuildSpreadsheetML_EncodesValuesAndClampsSheetName() {
        String spreadsheet = ReportExportService.buildSpreadsheetML(
            'A&B012345678901234567890123456789',
            new List<String>{ 'Name <value>' },
            new List<List<String>>{
                new List<String>{ 'A "quoted" & value' }
            }
        );

        System.assert(spreadsheet.contains('ss:Name="A&amp;B012345678901234567890123"'));
        System.assert(spreadsheet.contains('Name &lt;value&gt;'));
        System.assert(spreadsheet.contains('A &quot;quoted&quot; &amp; value'));
        System.assert(spreadsheet.contains('<Workbook'));
        System.assert(spreadsheet.contains('</Workbook>'));
    }

    @IsTest
    static void testXmlEncode_BlankInputReturnsEmptyString() {
        System.assertEquals('', ReportExportService.xmlEncode(null));
        System.assertEquals('', ReportExportService.xmlEncode(''));
    }
}
