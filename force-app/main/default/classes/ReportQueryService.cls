/**
 * @description Service for querying Salesforce Reports with dynamic filter conditions.
 *              Supports condition-builder mode and validated raw-SOQL mode.
 *              All queries run with sharing to respect org visibility rules.
 * @group       MassReportExporter
 */
public with sharing class ReportQueryService {

    // ─── Inner DTOs ───────────────────────────────────────────────────────────

    /** A single filter condition sent from the LWC filter builder. */
    public class FilterCondition {
        @AuraEnabled public String field    { get; set; }
        @AuraEnabled public String operator { get; set; }
        @AuraEnabled public String value    { get; set; }
    }

    /** One report row returned to the datatable. */
    public class ReportRecord {
        @AuraEnabled public String id            { get; set; }
        @AuraEnabled public String name          { get; set; }
        @AuraEnabled public String developerName { get; set; }
        @AuraEnabled public String folderName    { get; set; }
    }

    /** Paginated search result wrapper. */
    public class ReportSearchResult {
        @AuraEnabled public List<ReportRecord> records      { get; set; }
        @AuraEnabled public Integer            totalCount   { get; set; }
        @AuraEnabled public Boolean            success      { get; set; }
        @AuraEnabled public String             errorMessage { get; set; }

        public ReportSearchResult() {
            this.records      = new List<ReportRecord>();
            this.totalCount   = 0;
            this.success      = true;
            this.errorMessage = '';
        }
    }

    /** Validation result for raw SOQL input. */
    public class SOQLValidationResult {
        @AuraEnabled public Boolean valid        { get; set; }
        @AuraEnabled public String  errorMessage { get; set; }
    }

    /** Field descriptor for filter-builder dropdowns. Implements Comparable for label-sort. */
    public class FieldDescriptor implements Comparable {
        @AuraEnabled public String apiName { get; set; }
        @AuraEnabled public String label   { get; set; }
        @AuraEnabled public String type    { get; set; }

        public Integer compareTo(Object other) {
            FieldDescriptor o = (FieldDescriptor) other;
            return this.label.compareTo(o.label);
        }
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    @TestVisible private static final Integer DEFAULT_PAGE_SIZE = 10;
    @TestVisible private static final Integer MAX_QUERY_LIMIT   = 2000;

    private static final String BASE_SELECT   = 'SELECT Id, Name, DeveloperName, FolderName FROM Report';
    private static final String DEFAULT_ORDER = ' ORDER BY Name ASC';

    private static final Set<String> BLOCKED_KEYWORDS = new Set<String>{
        ';', '--', '/*', '*/', 'delete', 'update', 'insert',
        'upsert', 'merge', 'union', 'drop', 'alter', 'truncate'
    };

    // ─── Public AuraEnabled Methods ───────────────────────────────────────────

    /**
     * @description Returns all accessible fields on the Report sObject,
     *              sorted by label, for populating the filter-builder field dropdown.
     */
    @AuraEnabled(cacheable=true)
    public static List<FieldDescriptor> getReportFields() {
        List<FieldDescriptor> fields = new List<FieldDescriptor>();
        Map<String, Schema.SObjectField> fieldMap =
            Schema.SObjectType.Report.fields.getMap();

        for (Schema.SObjectField sof : fieldMap.values()) {
            Schema.DescribeFieldResult dfr = sof.getDescribe();
            if (!dfr.isAccessible()) { continue; }
            FieldDescriptor fd = new FieldDescriptor();
            fd.apiName = dfr.getName();
            fd.label   = dfr.getLabel();
            fd.type    = dfr.getType().name().toLowerCase();
            fields.add(fd);
        }
        fields.sort();
        return fields;
    }

    /**
     * @description Runs a server-side paginated query from UI-built filter conditions.
     * @param conditionsJson  JSON array of FilterCondition objects
     * @param logic           'AND' or 'OR'
     * @param pageSize        Records per page
     * @param offset          Zero-based pagination offset
     */
    @AuraEnabled
    public static ReportSearchResult searchReports(
        String  conditionsJson,
        String  logic,
        Integer pageSize,
        Integer offset
    ) {
        ReportSearchResult result = new ReportSearchResult();
        try {
            List<FilterCondition> conditions = deserializeConditions(conditionsJson);
            String whereClause = buildWhereClause(conditions, logic);

            result.totalCount = Database.countQuery(
                'SELECT COUNT() FROM Report' + whereClause
            );

            String query = BASE_SELECT + whereClause + DEFAULT_ORDER
                + ' LIMIT '  + safePage(pageSize)
                + ' OFFSET ' + safeOff(offset);

            result.records = toRecordList((List<Report>) Database.query(query));
        } catch (Exception ex) {
            result.success      = false;
            result.errorMessage = ex.getMessage();
        }
        return result;
    }

    /**
     * @description Returns all Report IDs matching the current filter (no pagination).
     *              Used for "Select All N Records across pages" feature.
     */
    @AuraEnabled
    public static List<String> getAllReportIds(String conditionsJson, String logic) {
        List<FilterCondition> conditions = deserializeConditions(conditionsJson);
        String whereClause = buildWhereClause(conditions, logic);
        String query = 'SELECT Id FROM Report' + whereClause
            + DEFAULT_ORDER + ' LIMIT ' + MAX_QUERY_LIMIT;

        List<String> ids = new List<String>();
        for (Report r : (List<Report>) Database.query(query)) {
            ids.add(r.Id);
        }
        return ids;
    }

    /**
     * @description Validates a raw SOQL string with 5 checks:
     *              (1) blank guard, (2) injection keyword blocklist,
     *              (3) Report-object whitelist, (4) governor LIMIT guard,
     *              (5) Database.query parse-check.
     */
    @AuraEnabled
    public static SOQLValidationResult validateSOQL(String rawSOQL) {
        SOQLValidationResult result = new SOQLValidationResult();
        result.valid        = false;
        result.errorMessage = '';

        if (String.isBlank(rawSOQL)) {
            result.errorMessage = 'SOQL query cannot be empty.';
            return result;
        }

        String normalized = rawSOQL.toLowerCase().trim();

        // 1. Injection keyword guard
        for (String blocked : BLOCKED_KEYWORDS) {
            if (normalized.contains(blocked)) {
                result.errorMessage = 'Disallowed keyword or character detected: "'
                    + blocked + '". Please remove it and try again.';
                return result;
            }
        }

        // 2. Object whitelist — must target Report
        if (!normalized.contains('from report')) {
            result.errorMessage = 'Query must target the Report object (FROM Report).';
            return result;
        }

        // 3. Governor guard — inject LIMIT if missing
        String finalQuery = rawSOQL.trim();
        if (!normalized.contains('limit')) {
            finalQuery += ' LIMIT ' + MAX_QUERY_LIMIT;
        }

        // 4. Parse check
        try {
            Database.query(finalQuery);
            result.valid = true;
        } catch (Exception ex) {
            result.errorMessage = ex.getMessage();
        }

        return result;
    }

    /**
     * @description Executes a validated raw SOQL with server-side pagination.
     *              Re-validates on server — never trust client-side state alone.
     */
    @AuraEnabled
    public static ReportSearchResult searchReportsByRawSOQL(
        String  rawSOQL,
        Integer pageSize,
        Integer offset
    ) {
        ReportSearchResult result = new ReportSearchResult();
        try {
            SOQLValidationResult v = validateSOQL(rawSOQL);
            if (!v.valid) {
                result.success      = false;
                result.errorMessage = v.errorMessage;
                return result;
            }

            String normalized  = rawSOQL.toLowerCase().trim();
            String whereClause = extractWhereClause(rawSOQL, normalized);

            result.totalCount = Database.countQuery(
                'SELECT COUNT() FROM Report' + whereClause
            );

            String query = BASE_SELECT + whereClause + DEFAULT_ORDER
                + ' LIMIT '  + safePage(pageSize)
                + ' OFFSET ' + safeOff(offset);

            result.records = toRecordList((List<Report>) Database.query(query));
        } catch (Exception ex) {
            result.success      = false;
            result.errorMessage = ex.getMessage();
        }
        return result;
    }

    // ─── Private Helpers ──────────────────────────────────────────────────────

    private static List<FilterCondition> deserializeConditions(String jsonString) {
        if (String.isBlank(jsonString)) { return new List<FilterCondition>(); }
        return (List<FilterCondition>)
            System.JSON.deserialize(jsonString, List<FilterCondition>.class);
    }

    private static String buildWhereClause(
        List<FilterCondition> conditions,
        String logic
    ) {
        if (conditions == null || conditions.isEmpty()) { return ''; }

        Set<String> validFields =
            Schema.SObjectType.Report.fields.getMap().keySet();

        List<String> clauses = new List<String>();
        for (FilterCondition c : conditions) {
            if (String.isBlank(c.field))                            { continue; }
            if (!validFields.contains(c.field.toLowerCase()))       { continue; }
            String clause = buildSingleClause(c);
            if (String.isNotBlank(clause)) { clauses.add(clause); }
        }

        if (clauses.isEmpty()) { return ''; }
        String joiner = (logic == 'OR') ? ' OR ' : ' AND ';
        return ' WHERE ' + String.join(clauses, joiner);
    }

    @TestVisible
    private static String buildSingleClause(FilterCondition c) {
        String f  = c.field;
        String op = c.operator != null ? c.operator.toLowerCase() : '';
        String v  = c.value   != null ? c.value   : '';

        switch on op {
            when '='               { return f + ' = \''  + String.escapeSingleQuotes(v) + '\''; }
            when '!='              { return f + ' != \'' + String.escapeSingleQuotes(v) + '\''; }
            when '<'               { return f + ' < '   + v; }
            when '<='              { return f + ' <= '  + v; }
            when '>'               { return f + ' > '   + v; }
            when '>='              { return f + ' >= '  + v; }
            when 'starts with'     { return f + ' LIKE \'' + String.escapeSingleQuotes(v) + '%\''; }
            when 'ends with'       { return f + ' LIKE \'%' + String.escapeSingleQuotes(v) + '\''; }
            when 'contains'        { return f + ' LIKE \'%' + String.escapeSingleQuotes(v) + '%\''; }
            when 'does not contain'{ return '(NOT ' + f + ' LIKE \'%' + String.escapeSingleQuotes(v) + '%\')'; }
            when 'in'              { return f + ' IN ('     + quoteList(v) + ')'; }
            when 'not in'          { return f + ' NOT IN (' + quoteList(v) + ')'; }
            when 'includes'        { return f + ' INCLUDES (' + quoteList(v) + ')'; }
            when 'excludes'        { return f + ' EXCLUDES (' + quoteList(v) + ')'; }
            when '= null'          { return f + ' = null'; }
            when '!= null'         { return f + ' != null'; }
            when '= true'          { return f + ' = true'; }
            when '= false'         { return f + ' = false'; }
            when else              { return ''; }
        }
    }

    private static String quoteList(String raw) {
        List<String> parts  = raw.split(',');
        List<String> quoted = new List<String>();
        for (String p : parts) {
            quoted.add('\'' + String.escapeSingleQuotes(p.trim()) + '\'');
        }
        return String.join(quoted, ', ');
    }

    private static String extractWhereClause(String rawSOQL, String normalized) {
        if (!normalized.contains('where')) { return ''; }
        Integer whereIdx = normalized.indexOf('where');
        String afterWhere = rawSOQL.substring(whereIdx);
        // Strip ORDER BY / LIMIT / OFFSET / GROUP BY that may follow
        afterWhere = afterWhere.replaceAll('(?i)\\s+(ORDER\\s+BY|LIMIT|OFFSET|GROUP\\s+BY).*', '');
        return ' ' + afterWhere.trim();
    }

    private static List<ReportRecord> toRecordList(List<Report> reports) {
        List<ReportRecord> records = new List<ReportRecord>();
        for (Report r : reports) {
            ReportRecord rr  = new ReportRecord();
            rr.id            = r.Id;
            rr.name          = r.Name;
            rr.developerName = r.DeveloperName;
            rr.folderName    = r.FolderName;
            records.add(rr);
        }
        return records;
    }

    private static Integer safePage(Integer p) {
        return (p != null && p > 0 && p <= 200) ? p : DEFAULT_PAGE_SIZE;
    }

    private static Integer safeOff(Integer o) {
        return (o != null && o >= 0) ? o : 0;
    }
}
