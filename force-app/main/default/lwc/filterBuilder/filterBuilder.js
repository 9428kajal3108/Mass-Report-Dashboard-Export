import { LightningElement, api, track } from 'lwc';
import validateSOQL          from '@salesforce/apex/ReportQueryService.validateSOQL';
import validateDashboardSOQL from '@salesforce/apex/DashboardQueryService.validateDashboardSOQL';

let _nextId = 0;
const newCondition = () => ({ id: ++_nextId, field: '', operator: '', value: '', logic: 'AND' });

export default class FilterBuilder extends LightningElement {

    /** Field descriptors from parent (loaded via @wire in root). */
    @api fields = [];

    @track mode            = 'builder'; // 'builder' | 'raw'
    @track conditions      = [newCondition()];
    @track rawSOQL         = '';
    @track isValidating    = false;
    @track validationError = '';
    @track isValidated     = false;

    // Tracks whether we are still on the initial load (before any explicit search)
    _initialLoad = true;

    // ─── Getters ──────────────────────────────────────────────────────────────

    get isReportsMode()    { return this.objectMode === 'reports'; }
    get isDashboardsMode() { return this.objectMode === 'dashboards'; }

    get cardTitle() {
        return this.isDashboardsMode ? 'Filter Dashboards' : 'Filter Reports';
    }
    get cardIconName() {
        return 'utility:filter';
    }

    get searchButtonLabel() {
        return this.isDashboardsMode ? 'Search Dashboards' : 'Search Reports';
    }

    get soqlPlaceholder() {
        if (this.isDashboardsMode) {
            return 'SELECT Id, Title, DeveloperName, FolderName FROM Dashboard WHERE ...';
        }
        return 'SELECT Id, Name, DeveloperName, FolderName FROM Report WHERE ...';
    }

    get isBuilderMode()   { return this.mode === 'builder'; }
    get isRawMode()       { return this.mode === 'raw'; }
    get hasConditions()   {
        return this.conditions.some(c => c.field && c.operator);
    }
    get builderVariant()  { return this.mode === 'builder' ? 'brand' : 'neutral'; }
    get rawVariant()      { return this.mode === 'raw'     ? 'brand' : 'neutral'; }

    /**
     * Conditions enriched with:
     *   idx        — original array index (used by filterRow for remove/change events)
     *   showJoin   — true for every row except the first, triggers AND/OR badge above it
     *   isOnly     — true when there is exactly one condition (hides the delete button)
     *   andVariant — 'brand' if this condition's join logic is AND, otherwise 'neutral'
     *   orVariant  — 'brand' if this condition's join logic is OR, otherwise 'neutral'
     */
    get conditionsWithMeta() {
        const only = this.conditions.length === 1;
        return this.conditions.map((c, i) => {
            const rowLogic = c.logic || 'AND';
            return {
                ...c,
                idx:        i,
                showJoin:   i > 0,
                isOnly:     only,
                andVariant: rowLogic === 'AND' ? 'brand' : 'neutral',
                orVariant:  rowLogic === 'OR'  ? 'brand' : 'neutral'
            };
        });
    }

    get isSearchDisabled() {
        if (this.mode === 'raw') {
            return !this.isValidated || this.isValidating;
        }
        // In builder mode, allow search even with no conditions (will load all)
        return false;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    connectedCallback() {
        this._resetState();
        // Trigger an initial load of all records with empty conditions
        this._fireSearchRequest();
    }

    // Watch for objectMode changes from parent
    @api
    get objectMode() {
        return this._objectMode;
    }
    set objectMode(value) {
        const prev = this._objectMode;
        this._objectMode = value;
        if (prev !== undefined && prev !== value) {
            this._resetState();
            // Reload all records for the newly selected mode
            this._fireSearchRequest();
        }
    }

    get defaultRawSOQL() {
        return this.isDashboardsMode
            ? 'SELECT Id, Title, DeveloperName, FolderName FROM Dashboard'
            : 'SELECT Id, Name, DeveloperName, FolderName FROM Report';
    }

    _resetState() {
        this.conditions      = [newCondition()];
        this.rawSOQL         = this.defaultRawSOQL;
        this.mode            = 'builder';
        this.isValidated     = true; // default SOQL is valid by default
        this.validationError = '';
        this._initialLoad    = true;
    }

    // ─── Mode Switching ───────────────────────────────────────────────────────

    switchToBuilder() {
        this.mode            = 'builder';
        this.isValidated     = false;
        this.validationError = '';
    }

    switchToRaw() {
        this.mode            = 'raw';
        this.isValidated     = false;
        this.validationError = '';
    }

    // ─── Condition Builder Handlers ───────────────────────────────────────────

    addCondition() {
        this.conditions  = [...this.conditions, newCondition()];
        this._initialLoad = false;
    }

    handleConditionChange(event) {
        const { index, condition } = event.detail;
        this.conditions = this.conditions.map((c, i) =>
            i === index ? { ...c, ...condition } : c
        );
        // Once user starts filling in conditions the initial hint is no longer relevant
        this._initialLoad = false;
    }

    handleConditionRemove(event) {
        const { index } = event.detail;
        const updated = this.conditions.filter((_, i) => i !== index);
        this.conditions  = updated.length ? updated : [newCondition()];
        this._initialLoad = false;
    }

    handleSetAndLogic(event) {
        const index = parseInt(event.target.dataset.index, 10);
        this.conditions = this.conditions.map((c, i) =>
            i === index ? { ...c, logic: 'AND' } : c
        );
    }

    handleSetOrLogic(event) {
        const index = parseInt(event.target.dataset.index, 10);
        this.conditions = this.conditions.map((c, i) =>
            i === index ? { ...c, logic: 'OR' } : c
        );
    }

    // ─── Raw SOQL Handlers ────────────────────────────────────────────────────

    handleRawSOQLInput(event) {
        this.rawSOQL         = event.target.value;
        this.isValidated     = false;
        this.validationError = '';
        this._initialLoad    = false;
    }

    async handleValidate() {
        if (!this.rawSOQL || !this.rawSOQL.trim()) {
            this.validationError = 'Please enter a SOQL query before validating.';
            return;
        }
        this.isValidating    = true;
        this.validationError = '';
        this.isValidated     = false;
        try {
            let result;
            if (this.isDashboardsMode) {
                result = await validateDashboardSOQL({ rawSOQL: this.rawSOQL });
            } else {
                result = await validateSOQL({ rawSOQL: this.rawSOQL });
            }

            if (result.valid) {
                this.isValidated     = true;
                this.validationError = '';
            } else {
                this.validationError = result.errorMessage || 'Invalid SOQL.';
                this.isValidated     = false;
            }
        } catch (e) {
            this.validationError = e.body ? e.body.message : String(e);
        } finally {
            this.isValidating = false;
        }
    }

    // ─── Search / Clear ───────────────────────────────────────────────────────

    handleSearch() {
        this._initialLoad = false;
        this._fireSearchRequest();
    }

    handleClear() {
        this._resetState();
        this.dispatchEvent(new CustomEvent('clearfilters', { bubbles: true }));
        // After clear, reload all records (initial load behaviour)
        this._fireSearchRequest();
    }

    // ─── Private: fire searchrequest event ───────────────────────────────────

    _fireSearchRequest() {
        const validConditions = this.conditions
            .filter(c => c.field && c.operator)
            .map(c => ({
                field:    c.field,
                operator: c.operator,
                value:    c.value,
                logic:    c.logic || 'AND'
            }));

        const detail = {
            mode:       this.mode,
            conditions: validConditions,
            logic:      'AND', // backward compatibility fallback
            rawSOQL:    this.rawSOQL
        };
        this.dispatchEvent(
            new CustomEvent('searchrequest', { detail, bubbles: true })
        );
    }
}
