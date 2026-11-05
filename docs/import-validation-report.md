# Import Report — meridian-receivables-2026-11-02.xlsx

- **Snapshot Date**: `2026-11-02`
- **Detected Header Row**: Row `4`
- **Total Data Rows**: `1452`
- **Customer-Visible Valid Rows**: `1429`
- **Held-Back Rows (Data-Quality Queue)**: `14`
- **Duplicates Skipped**: `9`
- **Ignored Blank/Footer Rows**: `2`
- **#REF! Formula Errors Resolved**: `5`
- **Swapped Date Flags**: `10`
- **Installment 0 (Upfront 1/1)**: `8`
- **Negative Credit/Refund Rows**: `3`

## Rows Held Back from Customer Visibility (14)

| Row | Group | Policy No. | Installment | Amount (BRL) | Reason Held Back |
|---|---|---|---|---:|---|
| 7 | Construtora Pilar | `0246202524821711` | 1/1 | R$ 40076.14 | Missing Policyholder name or Tax ID |
| 16 | Construtora Pilar | `0246202578734411` | 10/10 | R$ 4128.06 | Suspicious date order: Extended Due Date is earlier than Original Due Date |
| 28 | Grupo Vértice Química | `5100-2026-555619` | 12/12 | R$ 43472.94 | Conflicting duplicate records in spreadsheet (rows 28 vs 1216) |
| 111 | Construtora Pilar | `0775.2025.21262262` | 2/4 | R$ 39501.36 | Suspicious date order: Extended Due Date is earlier than Original Due Date |
| 116 | Construtora Pilar | `0775.2025.32350323` | 2/4 | R$ 9095.62 | Conflicting duplicate records in spreadsheet (rows 116 vs 510) |
| 263 | Grupo Atlântica | `BR-77-289916` | 2/4 | R$ 33793.11 | Missing Policyholder name or Tax ID |
| 311 | Grupo Atlântica | `5100-2026-499258` | 3/12 | R$ 3193.19 | Suspicious date order: Extended Due Date is earlier than Original Due Date |
| 397 | Grupo Atlântica | `BR-77-700679` | 4/12 | R$ 19423.20 | Conflicting duplicate records in spreadsheet (rows 397 vs 398) |
| 496 | Grupo Atlântica | `01.18.8775634` | 2/3 | R$ 5454.03 | Suspicious date order: Extended Due Date is earlier than Original Due Date |
| 529 | Grupo Atlântica | `BR-77-870764` | 5/12 | R$ 2411.82 | Suspicious date order: Extended Due Date is earlier than Original Due Date |
| 629 | Grupo Atlântica | `01.18.9034489` | 2/12 | R$ 5159.22 | Conflicting duplicate records in spreadsheet (rows 629 vs 630) |
| 812 | Grupo Horizonte | `BR-77-388151` | 1/6 | R$ 69412.67 | Suspicious date order: Extended Due Date is earlier than Original Due Date |
| 1327 | Transportadora Rota Sul | `01.18.4349591` | 1/10 | R$ 1995.76 | Conflicting duplicate records in spreadsheet (rows 442 vs 1327) |
| 1427 | Transportadora Rota Sul | `5100-2026-231523` | 5/12 | R$ 5558.26 | Conflicting duplicate records in spreadsheet (rows 1427 vs 1428) |

## Duplicate Rows Skipped (9)

| Row | Key | Classification |
|---|---|---|
| 398 | `grupo atlantica|BR-77-700679|0|4` | Conflicting duplicate with row 397 |
| 442 | `transportadora rota sul|01.18.4349591|0|1` | Suspicious date order: Extended Due Date is earlier than Original Due Date; Conflicting duplicate with row 1327 |
| 510 | `construtora pilar|0775.2025.32350323|0|2` | Suspicious date order: Extended Due Date is earlier than Original Due Date; Conflicting duplicate with row 116 |
| 630 | `grupo atlantica|01.18.9034489|0|2` | Suspicious date order: Extended Due Date is earlier than Original Due Date; Conflicting duplicate with row 629 |
| 1058 | `grupo serra verde|BR-77-249773|0|8` | Exact duplicate of row 1057 |
| 1216 | `grupo vertice quimica|5100-2026-555619|0|12` | Conflicting duplicate with row 28 |
| 1276 | `mineracao ferro alto|0246202650737921|0|5` | Exact duplicate of row 1275 |
| 1428 | `transportadora rota sul|5100-2026-231523|0|5` | Suspicious date order: Extended Due Date is earlier than Original Due Date; Conflicting duplicate with row 1427 |
| 1440 | `transportadora rota sul|5100-2026-252099|0|3` | Exact duplicate of row 322 |

## #REF! Formula Errors Resolved (5)

| Row | Group | Policy No. | Original Due | Extended Due | Resolved Current Due |
|---|---|---|---|---|---|
| 252 | Grupo Atlântica | `01.18.7502623` | 2026-10-11 | 2026-10-24 | **2026-10-24** |
| 594 | Grupo Atlântica | `SNT4469641281` | 2026-11-21 | — | **2026-11-21** |
| 1056 | Grupo Serra Verde | `BR-77-218399` | 2026-11-26 | — | **2026-11-26** |
| 1369 | Transportadora Rota Sul | `BR-77-533054` | 2026-10-22 | 2026-11-05 | **2026-11-05** |
| 1374 | Transportadora Rota Sul | `BR-77-618975` | 2026-10-27 | — | **2026-10-27** |

## Upfront Installment 0 Normalized to 1/1 (8)

| Row | Group | Policyholder | Policy No. | Amount (BRL) |
|---|---|---|---|---:|
| 133 | Construtora Pilar | Pilar Incorporações SPE 14 Ltda. | `0775.2026.60881705` | R$ 20782.91 |
| 144 | Construtora Pilar | Pilar Incorporações SPE 14 Ltda. | `SNT2574647416` | R$ 31088.22 |
| 500 | Grupo Atlântica | Atlântica Logística S.A. | `01.18.9077566` | R$ 5004.97 |
| 658 | Grupo Atlântica | Atlântica Portos Ltda. | `BR-77-633475` | R$ 8398.66 |
| 790 | Grupo Horizonte | Horizonte Pay Ltda. | `01.18.4759521` | R$ 26388.46 |
| 1121 | Grupo Serra Verde | Usina Boa Vista Ltda. | `0246202543455658` | R$ 35300.19 |
| 1164 | Grupo Serra Verde | Usina Boa Vista Ltda. | `BR-77-873777` | R$ 33714.92 |
| 1196 | Grupo Vértice Química | Vértice Polímeros Ltda. | `01.18.6607370` | R$ 63158.45 |

## Negative Credit / Refund Endorsements (3)

| Row | Group | Policyholder | Policy No. | Endorsement | Credit Amount (BRL) |
|---|---|---|---|---|---:|
| 72 | Construtora Pilar | Pilar Engenharia Ltda. | `01.18.1364179` | 3 | R$ -6716.89 |
| 264 | Grupo Atlântica | Atlântica Energia S.A. | `BR-77-289916` | 3 | R$ -4818.11 |
| 851 | Grupo Horizonte | Horizonte Varejo S.A. | `5100-2025-947535` | 3 | R$ -4304.43 |