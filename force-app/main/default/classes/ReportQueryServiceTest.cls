/**
 * @description Unit tests for ReportQueryService.
 *              Uses @isTest context to verify filter building, validation,
 *              and pagination logic. Report sObject can be queried in tests.
 */
@IsTest
private class ReportQueryServiceTest {

    // ─── getReportFields ──────────────────────────────────────────────────────

    @IsTest
    static void testGetReportFields_ReturnsNonEmptyList() {
        Test.startTest();
        List<ReportQueryService.FieldDescriptor> fields =
            ReportQueryService.getReportFields();
        Test.stopTest();

        System.assertNotEquals(null, fields, 'Field list should not be null.');
        System.assert(!fields.isEmpty(), 'Field list should not be empty.');
        // Verify required fields are present
        Set<String> names = new Set<String>();
        for (ReportQueryService.FieldDescriptor fd : fields) { names.add(fd.apiName); }
        System.assert(names.contains('Name'), 'Name field expected.');
        System.assert(names.contains('FolderName'), 'FolderName field expected.');
    }

    // ─── searchReports ────────────────────────────────────────────────────────

    @IsTest
    static void testSearchReports_NoConditions_ReturnsAll() {
        Test.startTest();
        ReportQueryService.ReportSearchResult result =
            ReportQueryService.searchReports('[]', 'AND', 10, 0);
        Test.stopTest();

        System.assert(result.success, 'Expected success=true.');
        System.assert(result.totalCount >= 0, 'Total count must be non-negative.');
    }

    @IsTest
    static void testSearchReports_WithNameCondition() {
        // Build a condition that will return an empty or valid result
        List<Map<String, String>> conditions = new List<Map<String, String>>{
            new Map<String, String>{
                'field'    => 'Name',
                'operator' => 'starts with',
                'value'    => 'XYZZY_NO_MATCH_EXPECTED'
            }
        };
        String jsonStr = System.JSON.serialize(conditions);

        Test.startTest();
        ReportQueryService.ReportSearchResult result =
            ReportQueryService.searchReports(jsonStr, 'AND', 10, 0);
        Test.stopTest();

        System.assert(result.success, 'Expected success=true.');
        System.assertEquals(0, result.totalCount, 'Should be zero matches.');
    }

    @IsTest
    static void testSearchReports_InvalidField_IsIgnored() {
        List<Map<String, String>> conditions = new List<Map<String, String>>{
            new Map<String, String>{
                'field'    => 'INVALID_FIELD__c',
                'operator' => '=',
                'value'    => 'test'
            }
        };
        String jsonStr = System.JSON.serialize(conditions);

        Test.startTest();
        ReportQueryService.ReportSearchResult result =
            ReportQueryService.searchReports(jsonStr, 'AND', 10, 0);
        Test.stopTest();

        // Invalid field should be silently skipped — result is unfiltered
        System.assert(result.success, 'Should succeed even with invalid field.');
    }

    // ─── validateSOQL ─────────────────────────────────────────────────────────

    @IsTest
    static void testValidateSOQL_BlankInput() {
        Test.startTest();
        ReportQueryService.SOQLValidationResult r =
            ReportQueryService.validateSOQL('');
        Test.stopTest();

        System.assertEquals(false, r.valid);
        System.assert(r.errorMessage.contains('empty'));
    }

    @IsTest
    static void testValidateSOQL_InjectionBlocked() {
        Test.startTest();
        ReportQueryService.SOQLValidationResult r =
            ReportQueryService.validateSOQL(
                'SELECT Id FROM Report WHERE Name = \'x\'; DELETE FROM Report'
            );
        Test.stopTest();

        System.assertEquals(false, r.valid);
        System.assert(r.errorMessage.toLowerCase().contains('disallowed'));
    }

    @IsTest
    static void testValidateSOQL_WrongObject() {
        Test.startTest();
        ReportQueryService.SOQLValidationResult r =
            ReportQueryService.validateSOQL(
                'SELECT Id FROM Account WHERE Name = \'Test\''
            );
        Test.stopTest();

        System.assertEquals(false, r.valid);
        System.assert(r.errorMessage.contains('Report'));
    }

    @IsTest
    static void testValidateSOQL_ValidQuery() {
        Test.startTest();
        ReportQueryService.SOQLValidationResult r =
            ReportQueryService.validateSOQL(
                'SELECT Id, Name FROM Report WHERE Name != null'
            );
        Test.stopTest();

        System.assertEquals(true, r.valid, 'Expected valid query.');
    }

    // ─── buildSingleClause ────────────────────────────────────────────────────

    @IsTest
    static void testBuildSingleClause_AllOperators() {
        Map<String, String> expectations = new Map<String, String>{
            '='               => 'Name = \'test\'',
            '!='              => 'Name != \'test\'',
            'starts with'     => 'Name LIKE \'test%\'',
            'ends with'       => 'Name LIKE \'%test\'',
            'contains'        => 'Name LIKE \'%test%\'',
            'does not contain'=> '(NOT Name LIKE \'%test%\')',
            '= null'          => 'Name = null',
            '!= null'         => 'Name != null',
            '= true'          => 'Name = true',
            '= false'         => 'Name = false'
        };

        for (String op : expectations.keySet()) {
            ReportQueryService.FilterCondition c = new ReportQueryService.FilterCondition();
            c.field    = 'Name';
            c.operator = op;
            c.value    = 'test';

            String clause = ReportQueryService.buildSingleClause(c);
            System.assertEquals(
                expectations.get(op), clause,
                'Unexpected clause for operator: ' + op
            );
        }
    }

    // ─── getAllReportIds ───────────────────────────────────────────────────────

    @IsTest
    static void testGetAllReportIds_ReturnsStringList() {
        Test.startTest();
        List<String> ids = ReportQueryService.getAllReportIds('[]', 'AND');
        Test.stopTest();

        System.assertNotEquals(null, ids);
        // Each ID should be a valid Salesforce ID
        for (String id : ids) {
            System.assertEquals(18, id.length(), 'Expected 18-char ID.');
        }
    }

    // ─── searchReportsByRawSOQL ───────────────────────────────────────────────

    @IsTest
    static void testSearchReportsByRawSOQL_Valid() {
        Test.startTest();
        ReportQueryService.ReportSearchResult result =
            ReportQueryService.searchReportsByRawSOQL(
                'SELECT Id, Name FROM Report WHERE Name != null',
                10, 0
            );
        Test.stopTest();

        System.assert(result.success);
        System.assert(result.totalCount >= 0);
    }

    @IsTest
    static void testSearchReportsByRawSOQL_InvalidQuery_ReturnsError() {
        Test.startTest();
        ReportQueryService.ReportSearchResult result =
            ReportQueryService.searchReportsByRawSOQL(
                'SELECT BadField FROM Report', 10, 0
            );
        Test.stopTest();

        System.assertEquals(false, result.success);
        System.assert(String.isNotBlank(result.errorMessage));
    }
}
