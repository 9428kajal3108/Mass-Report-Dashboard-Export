import { LightningElement, api, track } from 'lwc';

// Operators available by field type
const OPERATORS_BY_TYPE = {
    string: [
        { label: '=',                value: '=' },
        { label: '≠ (!=)',           value: '!=' },
        { label: 'starts with',      value: 'starts with' },
        { label: 'ends with',        value: 'ends with' },
        { label: 'contains',         value: 'contains' },
        { label: 'does not contain',  value: 'does not contain' },
        { label: 'in',               value: 'in' },
        { label: 'not in',           value: 'not in' },
        { label: '= null',           value: '= null' },
        { label: '≠ null',           value: '!= null' }
    ],
    textarea: [
        { label: 'contains',         value: 'contains' },
        { label: 'does not contain',  value: 'does not contain' },
        { label: 'starts with',      value: 'starts with' },
        { label: '= null',           value: '= null' },
        { label: '≠ null',           value: '!= null' }
    ],
    id: [
        { label: '=',    value: '=' },
        { label: '≠',    value: '!=' },
        { label: 'in',   value: 'in' },
        { label: 'not in', value: 'not in' },
        { label: '= null', value: '= null' },
        { label: '≠ null', value: '!= null' }
    ],
    boolean: [
        { label: '= true',  value: '= true' },
        { label: '= false', value: '= false' },
        { label: '= null',  value: '= null' },
        { label: '≠ null',  value: '!= null' }
    ],
    date: [
        { label: '=',    value: '=' },
        { label: '≠',    value: '!=' },
        { label: '<',    value: '<' },
        { label: '≤',    value: '<=' },
        { label: '>',    value: '>' },
        { label: '≥',    value: '>=' },
        { label: '= null', value: '= null' },
        { label: '≠ null', value: '!= null' }
    ],
    datetime: [
        { label: '=',    value: '=' },
        { label: '≠',    value: '!=' },
        { label: '<',    value: '<' },
        { label: '≤',    value: '<=' },
        { label: '>',    value: '>' },
        { label: '≥',    value: '>=' },
        { label: '= null', value: '= null' },
        { label: '≠ null', value: '!= null' }
    ],
    double: [
        { label: '=',    value: '=' },
        { label: '≠',    value: '!=' },
        { label: '<',    value: '<' },
        { label: '≤',    value: '<=' },
        { label: '>',    value: '>' },
        { label: '≥',    value: '>=' },
        { label: '= null', value: '= null' },
        { label: '≠ null', value: '!= null' }
    ],
    integer: [
        { label: '=',    value: '=' },
        { label: '≠',    value: '!=' },
        { label: '<',    value: '<' },
        { label: '≤',    value: '<=' },
        { label: '>',    value: '>' },
        { label: '≥',    value: '>=' }
    ],
    picklist: [
        { label: '=',       value: '=' },
        { label: '≠',       value: '!=' },
        { label: 'in',      value: 'in' },
        { label: 'not in',  value: 'not in' },
        { label: '= null',  value: '= null' },
        { label: '≠ null',  value: '!= null' }
    ],
    multipicklist: [
        { label: 'includes', value: 'includes' },
        { label: 'excludes', value: 'excludes' },
        { label: '= null',   value: '= null' },
        { label: '≠ null',   value: '!= null' }
    ]
};

const NO_VALUE_OPERATORS = new Set(['= null', '!= null', '= true', '= false']);
const DEFAULT_OPERATORS  = OPERATORS_BY_TYPE.string;

export default class FilterRow extends LightningElement {
    /** Index of this row — used to identify which row fired an event. */
    @api rowIndex = 0;

    /** Array of {apiName, label, type} from Apex getReportFields() */
    @api fields = [];

    /** Current condition: { field, operator, value } */
    @api condition = { field: '', operator: '', value: '' };

    /** Show the "+ Add Condition" button inline on this row (last row only). */
    @api showAddButton = false;

    // ─── Getters ──────────────────────────────────────────────────────────────

    get fieldOptions() {
        return (this.fields || []).map(f => ({ label: f.label, value: f.apiName }));
    }

    get operatorOptions() {
        if (!this.condition || !this.condition.field) { return DEFAULT_OPERATORS; }
        const field = (this.fields || []).find(f => f.apiName === this.condition.field);
        if (!field) { return DEFAULT_OPERATORS; }
        return OPERATORS_BY_TYPE[field.type] || DEFAULT_OPERATORS;
    }

    get isOperatorDisabled() {
        return !this.condition || !this.condition.field;
    }

    get isValueHidden() {
        return this.condition && NO_VALUE_OPERATORS.has(this.condition.operator);
    }

    get valuePlaceholder() {
        const op = this.condition && this.condition.operator;
        if (op === 'in' || op === 'not in' || op === 'includes' || op === 'excludes') {
            return 'value1, value2, value3';
        }
        return 'Enter value...';
    }

    // ─── Event Handlers ───────────────────────────────────────────────────────

    handleFieldChange(event) {
        this._dispatchChange({ field: event.detail.value, operator: '', value: '' });
    }

    handleOperatorChange(event) {
        const newOp  = event.detail.value;
        const newVal = NO_VALUE_OPERATORS.has(newOp) ? '' : (this.condition.value || '');
        this._dispatchChange({ ...this.condition, operator: newOp, value: newVal });
    }

    handleValueChange(event) {
        this._dispatchChange({ ...this.condition, value: event.detail.value });
    }

    handleRemove() {
        this.dispatchEvent(
            new CustomEvent('conditionremove', {
                bubbles: true,
                detail: { index: this.rowIndex }
            })
        );
    }

    handleAdd() {
        this.dispatchEvent(
            new CustomEvent('addcondition', { bubbles: true })
        );
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _dispatchChange(newCondition) {
        this.dispatchEvent(
            new CustomEvent('conditionchange', {
                bubbles: true,
                detail: { index: this.rowIndex, condition: newCondition }
            })
        );
    }
}
