"use client";

import {
  ClientSideRowModelModule,
  QuickFilterModule,
  TextFilterModule,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";

const modules = [ClientSideRowModelModule, TextFilterModule, QuickFilterModule];

// Batik palette, shared with globals.css. AG Studio replaces these grids on 31 Oct.
const theme = themeQuartz.withParams({
  fontFamily: "var(--font)",
  accentColor: "var(--accent)",
  foregroundColor: "var(--ink)",
  backgroundColor: "var(--surface)",
  borderColor: "var(--border)",
  headerTextColor: "var(--muted)",
  headerFontWeight: 600,
});

export function DataGrid<T extends object>({ rows, columns, height = 320 }: { rows: T[]; columns: ColDef<T>[]; height?: number }) {
  return (
    <div style={{ height }}>
      <AgGridProvider modules={modules}>
        <AgGridReact<T>
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={{ sortable: true, filter: true, resizable: true, flex: 1, minWidth: 110 }}
          getRowId={(p) => String((p.data as { id: string }).id)}
        />
      </AgGridProvider>
    </div>
  );
}
