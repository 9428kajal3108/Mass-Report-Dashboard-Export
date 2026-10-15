/**
 * @description Service for querying Salesforce Dashboards with dynamic filter conditions.
 *              Only returns Dashboards the running user has access to (WITH USER_MODE).
 *              Supports condition-builder mode and validated raw-SOQL mode.
 * @group       MassReportExporter
 */
public with sharing class DashboardQueryService {

    // ─── Inner DTOs ───────────────────────────────────────────────────────────

    /** A single filter condition sent from the LWC filter builder. */
    public class FilterCondition {
        @AuraEnabled public String field    { get; set; }
        @AuraEnabled public String operator { get; set; }
        @AuraEnabled public String value    { get; set; }
        @AuraEnabled public String logic    { get; set; } // 'AND' or 'OR' prefix joining to this condition
    }

    /** One dashboard row returned to the datatable. */
    public class DashboardRecord {
        @AuraEnabled public String id             { get; set; }
        @AuraEnabled public String name           { get; set; }
        @AuraEnabled public String developerName  { get; set; }
        @AuraEnabled public String folderName     { get; set; }
        @AuraEnabled public String type           { get; set; }
        @AuraEnabled public String createdByName  { get; set; }
    }

    /** Paginated search result wrapper. */
    public class DashboardSearchResult {
        @AuraEnabled public List<DashboardRecord> records      { get; set; }
        @AuraEnabled public Integer               totalCount   { get; set; }
        @AuraEnabled public Boolean               success      { get; set; }
        @AuraEnabled public String                errorMessage { get; set; }

        public DashboardSearchResult() {
            this.records      = new List<DashboardRecord>();
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

    /** Field descriptor for filter-builder dropdowns. */
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

    private static final String BASE_SELECT   = 'SELECT Id, Title, DeveloperName, FolderName, Type, CreatedBy.Name FROM Dashboard';
    private static final String DEFAULT_ORDER = ' ORDER BY Title ASC';

    private static final Set<String> BLOCKED_KEYWORDS = new Set<String>{
        ';', '--', '/*', '*/', 'delete', 'update', 'insert',
        'upsert', 'merge', 'union', 'drop', 'alter', 'truncate'
    };

    // Allowed queryable fields for Dashboard in filter builder
    private static final Set<String> ALLOWED_FIELDS = new Set<String>{
        'title', 'developername', 'foldername', 'type', 'description',
        'lastmodifieddate', 'createddate', 'ownerid', 'folderid'
    };

    // ─── Public AuraEnabled Methods ───────────────────────────────────────────

    /**
     * @description Returns queryable Dashboard fields for the filter-builder dropdown.
     */
    @AuraEnabled(cacheable=true)
    public static List<FieldDescriptor> getDashboardFields() {
        List<FieldDescriptor> fields = new List<FieldDescriptor>();
        Map<String, Schema.SObjectField> fieldMap =
            Schema.SObjectType.Dashboard.fields.getMap();

        for (Schema.SObjectField sof : fieldMap.values()) {
            Schema.DescribeFieldResult dfr = sof.getDescribe();
            if (!dfr.isAccessible())                            { continue; }
            if (!ALLOWED_FIELDS.contains(dfr.getName().toLowerCase())) { continue; }
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
     * @description Runs a server-side paginated query for Dashboards the current user can access.
     *              Uses WITH USER_MODE to enforce field-level and record-level sharing rules.
     *
     * @param conditionsJson  JSON array of FilterCondition objects
     * @param logic           'AND' or 'OR'
     * @param pageSize        Records per page
     * @param offset          Zero-based pagination offset
     */
    @AuraEnabled
    public static DashboardSearchResult searchDashboards(
        String  conditionsJson,
        String  logic,
        Integer pageSize,
        Integer offset
    ) {
        DashboardSearchResult result = new DashboardSearchResult();
        try {
            Id currentUserId = UserInfo.getUserId();
            Set<Id> folderIds = null;
            Boolean isAdmin = isUserAdmin();
            if (!isAdmin) {
                folderIds = getAccessibleDashboardFolderIds();
            }

            List<FilterCondition> conditions = deserializeConditions(conditionsJson);
            String whereClause = buildWhereClause(conditions, logic);

            String accessFilter = (!isAdmin ? ' AND (CreatedById = :currentUserId OR FolderId IN :folderIds OR OwnerId IN :folderIds)' : '');
            String automatedFilter = ' AND CreatedBy.Name != \'Automated Process\'';
            String countWhere = String.isBlank(whereClause)
                ? ' WHERE CreatedBy.Name != \'Automated Process\'' + accessFilter
                : whereClause + automatedFilter + accessFilter;
            String dataWhere = countWhere;

            // AccessLevel.USER_MODE ensures only dashboards the user can read are returned
            result.totalCount = Database.countQuery(
                'SELECT COUNT() FROM Dashboard' + countWhere,
                AccessLevel.USER_MODE
            );

            String query = BASE_SELECT + dataWhere + DEFAULT_ORDER
                + ' LIMIT '  + safePage(pageSize)
                + ' OFFSET ' + safeOff(offset);

            result.records = toRecordList((List<Dashboard>) Database.query(query, AccessLevel.USER_MODE));
        } catch (Exception ex) {
            result.success      = false;
            result.errorMessage = ex.getMessage();
        }
        return result;
    }

    /**
     * @description Returns all accessible Dashboard IDs matching the current filter (no pagination).
     *              Used for "Select All N Records across pages" feature.
     */
    @AuraEnabled
    public static List<String> getAllDashboardIds(String conditionsJson, String logic) {
        Id currentUserId = UserInfo.getUserId();
        Set<Id> folderIds = null;
        Boolean isAdmin = isUserAdmin();
        if (!isAdmin) {
            folderIds = getAccessibleDashboardFolderIds();
        }

        List<FilterCondition> conditions = deserializeConditions(conditionsJson);
        String whereClause = buildWhereClause(conditions, logic);

        String accessFilter = (!isAdmin ? ' AND (CreatedById = :currentUserId OR FolderId IN :folderIds OR OwnerId IN :folderIds)' : '');
        String automatedFilter = ' AND CreatedBy.Name != \'Automated Process\'';
        String dataWhere = String.isBlank(whereClause)
            ? ' WHERE CreatedBy.Name != \'Automated Process\'' + accessFilter
            : whereClause + automatedFilter + accessFilter;

        String query = 'SELECT Id FROM Dashboard' + dataWhere
            + DEFAULT_ORDER + ' LIMIT ' + MAX_QUERY_LIMIT;

        List<String> ids = new List<String>();
        for (Dashboard d : (List<Dashboard>) Database.query(query, AccessLevel.USER_MODE)) {
            ids.add(d.Id);
        }
        return ids;
    }

    /**
     * @description Validates a raw SOQL string targeting Dashboard object.
     */
    @AuraEnabled
    public static SOQLValidationResult validateDashboardSOQL(String rawSOQL) {
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

        // 2. Object whitelist — must target Dashboard
        if (!normalized.contains('from dashboard')) {
            result.errorMessage = 'Query must target the Dashboard object (FROM Dashboard).';
            return result;
        }

        // 3. Governor guard — inject LIMIT if missing
        String finalQuery = rawSOQL.trim();
        if (!normalized.contains('limit')) {
            finalQuery += ' LIMIT ' + MAX_QUERY_LIMIT;
        }

        // 4. Parse check (AccessLevel.USER_MODE for safety)
        try {
            Database.query(finalQuery, AccessLevel.USER_MODE);
            result.valid = true;
        } catch (Exception ex) {
            result.errorMessage = ex.getMessage();
        }

        return result;
    }

    /**
     * @description Executes a validated raw SOQL for Dashboard with server-side pagination.
     *              Enforces AccessLevel.USER_MODE so only accessible dashboards are returned.
     */
    @AuraEnabled
    public static DashboardSearchResult searchDashboardsByRawSOQL(
        String  rawSOQL,
        Integer pageSize,
        Integer offset
    ) {
        DashboardSearchResult result = new DashboardSearchResult();
        try {
            SOQLValidationResult v = validateDashboardSOQL(rawSOQL);
            if (!v.valid) {
                result.success      = false;
                result.errorMessage = v.errorMessage;
                return result;
            }

            Id currentUserId = UserInfo.getUserId();
            Set<Id> folderIds = null;
            Boolean isAdmin = isUserAdmin();
            if (!isAdmin) {
                folderIds = getAccessibleDashboardFolderIds();
            }

            String normalized  = rawSOQL.toLowerCase().trim();
            String whereClause = extractWhereClause(rawSOQL, normalized);

            String accessFilter = (!isAdmin ? ' AND (CreatedById = :currentUserId OR FolderId IN :folderIds OR OwnerId IN :folderIds)' : '');
            String automatedFilter = ' AND CreatedBy.Name != \'Automated Process\'';
            String countWhere = String.isBlank(whereClause)
                ? ' WHERE CreatedBy.Name != \'Automated Process\'' + accessFilter
                : whereClause + automatedFilter + accessFilter;
            String dataWhere = countWhere;

            result.totalCount = Database.countQuery(
                'SELECT COUNT() FROM Dashboard' + countWhere,
                AccessLevel.USER_MODE
            );

            String query = BASE_SELECT + dataWhere + DEFAULT_ORDER
                + ' LIMIT '  + safePage(pageSize)
                + ' OFFSET ' + safeOff(offset);

            result.records = toRecordList((List<Dashboard>) Database.query(query, AccessLevel.USER_MODE));
        } catch (Exception ex) {
            result.success      = false;
            result.errorMessage = ex.getMessage();
        }
        return result;
    }

    // ─── Access Control Helpers ───────────────────────────────────────────────

    @TestVisible
    private static Boolean isUserAdmin() {
        Id profileId = UserInfo.getProfileId();
        if (profileId != null) {
            List<Profile> profiles = [
                SELECT Name, PermissionsModifyAllData, PermissionsViewAllData
                FROM Profile
                WHERE Id = :profileId
                LIMIT 1
            ];
            if (!profiles.isEmpty()) {
                Profile p = profiles[0];
                if (p.Name == 'System Administrator' || p.PermissionsModifyAllData == true || p.PermissionsViewAllData == true) {
                    return true;
                }
            }
        }
        Integer adminPermSets = [
            SELECT COUNT()
            FROM PermissionSetAssignment
            WHERE AssigneeId = :UserInfo.getUserId()
            AND (PermissionSet.PermissionsModifyAllData = true OR PermissionSet.PermissionsViewAllData = true)
        ];
        return adminPermSets > 0;
    }

    @TestVisible
    private static Set<Id> getAccessibleDashboardFolderIds() {
        Set<Id> folderIds = new Set<Id>();
        folderIds.add(UserInfo.getUserId());
        folderIds.add(UserInfo.getOrganizationId());
        for (Folder f : [SELECT Id FROM Folder WHERE Type = 'Dashboard']) {
            folderIds.add(f.Id);
        }
        return folderIds;
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

        List<String> clauses = new List<String>();
        List<String> joins   = new List<String>();

        for (FilterCondition c : conditions) {
            if (String.isBlank(c.field))                            { continue; }
            if (!ALLOWED_FIELDS.contains(c.field.toLowerCase()))    { continue; }
            String clause = buildSingleClause(c);
            if (String.isBlank(clause))                             { continue; }

            clauses.add(clause);
            String joiner = (String.isNotBlank(c.logic) && c.logic.equalsIgnoreCase('OR')) ? 'OR' : 'AND';
            if (String.isBlank(c.logic) && String.isNotBlank(logic) && logic.equalsIgnoreCase('OR')) {
                joiner = 'OR';
            }
            joins.add(joiner);
        }

        if (clauses.isEmpty()) { return ''; }
        if (clauses.size() == 1) { return ' WHERE ' + clauses[0]; }

        // Check if all joins are pure AND or pure OR
        Boolean hasAnd = false;
        Boolean hasOr  = false;
        for (Integer i = 1; i < joins.size(); i++) {
            if (joins[i] == 'OR') { hasOr = true; }
            else { hasAnd = true; }
        }

        String whereBody = '';
        if (hasAnd && !hasOr) {
            whereBody = String.join(clauses, ' AND ');
        } else if (hasOr && !hasAnd) {
            whereBody = String.join(clauses, ' OR ');
        } else {
            // Mixed AND and OR requires parentheses in SOQL to avoid 'unexpected token' syntax errors
            whereBody = clauses[0];
            for (Integer i = 1; i < clauses.size(); i++) {
                whereBody = '(' + whereBody + ' ' + joins[i] + ' ' + clauses[i] + ')';
            }
        }

        return ' WHERE ' + whereBody;
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
            when '= null'          { return f + ' = null'; }
            when '!= null'         { return f + ' != null'; }
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
        afterWhere = afterWhere.replaceAll('(?i)\\s+(ORDER\\s+BY|LIMIT|OFFSET|GROUP\\s+BY|WITH).*', '');
        return ' ' + afterWhere.trim();
    }

    private static List<DashboardRecord> toRecordList(List<Dashboard> dashboards) {
        List<DashboardRecord> records = new List<DashboardRecord>();
        for (Dashboard d : dashboards) {
            DashboardRecord dr   = new DashboardRecord();
            dr.id             = d.Id;
            dr.name           = d.Title;
            dr.developerName  = d.DeveloperName;
            dr.folderName     = d.FolderName;
            dr.type           = d.Type;
            dr.createdByName  = d.CreatedBy != null ? d.CreatedBy.Name : '';
            records.add(dr);
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
