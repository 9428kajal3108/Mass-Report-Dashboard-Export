import { LightningElement, api, track } from 'lwc';
import validateSOQL          from '@salesforce/apex/ReportQueryService.validateSOQL';
import validateDashboardSOQL from '@salesforce/apex/DashboardQueryService.validateDashboardSOQL';

let _nextId = 0;
const newCondition = () => ({ id: ++_nextId, field: '', operator: '', value: '' });

export default class FilterBuilder extends LightningElement {

    /** Field descriptors from parent (loaded via @wire in root). */
    @api fields = [];

    @track mode            = 'builder'; // 'builder' | 'raw'
    @track conditions      = [newCondition()];
    @track logic           = 'AND';
    @track rawSOQL         = '';
    @track isValidating    = false;
    @track validationError = '';
    @track isValidated     = false;

    // ─── Getters ──────────────────────────────────────────────────────────────

    get isReportsMode()    { return this.objectMode === 'reports'; }
    get isDashboardsMode() { return this.objectMode === 'dashboards'; }

    get cardTitle()    {
        return this.isDashboardsMode ? 'Filter Dashboards' : 'Filter Reports';
    }
    get cardIconName() {
        return this.isDashboardsMode ? 'utility:filter' : 'utility:filter';
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
    get showLogicToggle() { return this.conditions.length > 1; }
    get hasConditions()   {
        return this.conditions.some(c => c.field && c.operator);
    }
    get builderVariant()  { return this.mode === 'builder' ? 'brand' : 'neutral'; }
    get rawVariant()      { return this.mode === 'raw'     ? 'brand' : 'neutral'; }
    get andVariant()      { return this.logic === 'AND' ? 'brand' : 'neutral'; }
    get orVariant()       { return this.logic === 'OR'  ? 'brand' : 'neutral'; }

    /** Conditions enriched with isLast flag so the last row shows the inline add button. */
    get conditionsWithMeta() {
        const last = this.conditions.length - 1;
        return this.conditions.map((c, i) => ({ ...c, isLast: i === last }));
    }

    get isSearchDisabled() {
        if (this.mode === 'raw') {
            return !this.isValidated || this.isValidating;
        }
        return !this.hasConditions;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * When objectMode changes (Reports ↔ Dashboards), reset the filter state
     * so stale conditions from the previous mode are cleared.
     */
    connectedCallback() {
        this._resetState();
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
        }
    }

    _objectMode = 'reports';

    _resetState() {
        this.conditions      = [newCondition()];
        this.logic           = 'AND';
        this.rawSOQL         = '';
        this.mode            = 'builder';
        this.isValidated     = false;
        this.validationError = '';
    }

    // ─── Mode Switching ───────────────────────────────────────────────────────

    switchToBuilder() {
        this.mode          = 'builder';
        this.isValidated   = false;
        this.validationError = '';
    }

    switchToRaw() {
        this.mode          = 'raw';
        this.isValidated   = false;
        this.validationError = '';
    }

    // ─── Condition Builder Handlers ───────────────────────────────────────────

    addCondition() {
        this.conditions = [...this.conditions, newCondition()];
    }

    handleConditionChange(event) {
        const { index, condition } = event.detail;
        this.conditions = this.conditions.map((c, i) =>
            i === index ? { ...c, ...condition } : c
        );
    }

    handleConditionRemove(event) {
        const { index } = event.detail;
        const updated = this.conditions.filter((_, i) => i !== index);
        this.conditions = updated.length ? updated : [newCondition()];
    }

    setAndLogic() { this.logic = 'AND'; }
    setOrLogic()  { this.logic = 'OR'; }

    // ─── Raw SOQL Handlers ────────────────────────────────────────────────────

    handleRawSOQLInput(event) {
        this.rawSOQL       = event.target.value;
        this.isValidated   = false;
        this.validationError = '';
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
        const detail = {
            mode:       this.mode,
            conditions: this.conditions.filter(c => c.field && c.operator),
            logic:      this.logic,
            rawSOQL:    this.rawSOQL
        };
        this.dispatchEvent(
            new CustomEvent('searchrequest', { detail, bubbles: true })
        );
    }

    handleClear() {
        this._resetState();
        this.dispatchEvent(new CustomEvent('clearfilters', { bubbles: true }));
    }
}
