export interface ColumnDef {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'boolean'
  sortable: boolean
}

// Every column maps 1:1 to a deliveries table field. Adding/removing a
// column here automatically updates the table, the sort dropdown, and
// (for text columns) the per-column filter — that's the point of having
// "any of the table headers" be filterable/sortable without hardcoding
// each one three times across the UI.
export const COLUMNS: ColumnDef[] = [
  { key: 'delivery_date', label: 'Delivery Date', type: 'date', sortable: true },
  { key: 'store_code', label: 'Store Code', type: 'text', sortable: true },
  { key: 'store_name', label: 'Store Name', type: 'text', sortable: true },
  { key: 'delivery_number', label: 'Delivery', type: 'number', sortable: true },
  { key: 'billing_document', label: 'Billing Document', type: 'number', sortable: true },
  { key: 'customer_name', label: 'Customer Name', type: 'text', sortable: true },
  { key: 'street', label: 'Street', type: 'text', sortable: false },
  { key: 'city', label: 'City', type: 'text', sortable: true },
  { key: 'country', label: 'Country', type: 'text', sortable: false },
  { key: 'telephone', label: 'Telephone', type: 'text', sortable: false },
  { key: 'supplier_store', label: 'Supplier Store', type: 'text', sortable: true },
  { key: 'ibt_from', label: 'IBT From', type: 'text', sortable: false },
  { key: 'ibt_to', label: 'IBT To', type: 'text', sortable: false },
  { key: 'obo_order', label: 'OBO Order', type: 'boolean', sortable: true },
  { key: 'created_on', label: 'Created On', type: 'date', sortable: true },
  { key: 'sales_document', label: 'Sales Document', type: 'number', sortable: false },
  { key: 'sales_representative', label: 'Sales Rep', type: 'text', sortable: true },
  { key: 'gross_weight_kg', label: 'Gross Weight (KG)', type: 'number', sortable: true },
  { key: 'net_weight_kg', label: 'Net Weight (KG)', type: 'number', sortable: true },
  { key: 'invoice_amount_zar', label: 'Invoice Amount (ZAR)', type: 'number', sortable: true },
  { key: 'transport1_amount_zar', label: 'Transport 1 (ZAR)', type: 'number', sortable: true },
  { key: 'transport2_amount_zar', label: 'Transport 2 (ZAR)', type: 'number', sortable: true },
]
