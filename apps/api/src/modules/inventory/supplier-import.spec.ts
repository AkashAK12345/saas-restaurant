import { describe, it, expect } from 'vitest';
import { parseSupplierSheet } from './supplier-import.js';

const HEADER = [
  'Name',
  'Email',
  'Company',
  'Phone',
  'Registered Under GST',
  'GST No',
  'Address',
  'City',
  'State',
  'Pin Code',
  'Type',
  'Tax collected at source(TCS %)',
  'Status',
  'FSSAI Lic No.',
  'PAN',
  'Shipping City',
];

describe('parseSupplierSheet', () => {
  it('reads a POS "Supplier" export, stored under the company, with the name kept as its label', () => {
    const parsed = parseSupplierSheet([
      ['Name:', 'Supplier'],
      ['Restaurant Name:', 'SAMCO RESTAURANT Mogappair'],
      [],
      HEADER,
      ['Shree Agencies', null, 'Shree Agencies', null, 'Yes', '33AJTPJ7001J1Z', '17/21 Ayya Mudali Street,\nSowcarpet', 'Chennai', 'Tamil Nadu', 600001, 'Purchase', 0, 'Active'],
      ['Seafood', null, 'Abad Foods', 8086060090, 'Yes', null, null, 'Chennai', 'Tamil Nadu', null, 'Both', 1.5, 'Inactive', 102938],
      ['Seafood', null, 'Nila Foods', 9841136236, 'No', null, null, null, null, null, 'Sale', 0, 'Active'],
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.ignored).toEqual(['Shipping City']);
    expect(parsed.suppliers).toEqual([
      {
        row: 5,
        name: 'Shree Agencies',
        label: null,
        phone: null,
        email: null,
        type: 'PURCHASE',
        is_active: true,
        gst_registered: true,
        gstin: '33AJTPJ7001J1Z',
        tcs_rate_bps: 0,
        fssai_no: null,
        pan: null,
        address: '17/21 Ayya Mudali Street,\nSowcarpet',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
      },
      expect.objectContaining({
        row: 6,
        name: 'Abad Foods',
        label: 'Seafood',
        phone: '8086060090',
        type: 'BOTH',
        is_active: false,
        tcs_rate_bps: 150,
        fssai_no: '102938',
      }),
      expect.objectContaining({ row: 7, name: 'Nila Foods', label: 'Seafood', type: 'SALE', gst_registered: false }),
    ]);
  });

  it('reports every bad row by its sheet row number, importing none of them', () => {
    const parsed = parseSupplierSheet([
      ['Name', 'Company', 'Type', 'TCS %', 'Phone'],
      ['Oil', 'Safco Oil', 'Purchase', 0, ''],
      ['', '', '', '', ''],
      ['Oil', 'safco  oil', 'Purchase', 0, ''],
      ['X', 'X Traders', 'Rental', 0, ''],
      ['Y', 'Y Traders', 'Both', 150, ''],
      ['Z', 'Z Traders', 'Both', 0, '9'.repeat(40)],
      ['', '', 'Both', 0, '98400'],
    ]);
    expect(parsed.errors).toEqual([
      'Row 4: "safco oil" appears more than once',
      'Row 5: type "Rental" is not Purchase, Sale or Both',
      'Row 6: TCS "150" is not a percentage',
      'Row 7: phone is over 32 characters',
      'Row 8: needs a name or a company',
    ]);
    expect(parsed.suppliers.map((s) => s.name)).toEqual(['Safco Oil']);
  });

  it('refuses a sheet that is not a supplier list', () => {
    expect(parseSupplierSheet([['Name', 'Unit']]).errors).toEqual([
      'No header row naming "Name" with "Company", "Phone" or "GST No"',
    ]);
  });
});
