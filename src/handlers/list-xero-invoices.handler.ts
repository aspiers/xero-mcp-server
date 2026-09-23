import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Invoice } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { formatDocumentDateFilter } from "../helpers/format-document-date-filter.js";

export interface ListInvoicesParams {
  page?: number;
  contactIds?: string[];
  invoiceNumbers?: string[];
  invoiceIds?: string[];
  statuses?: string[];
  where?: string;
  order?: string;
  fromDate?: string;
  toDate?: string;
}

// The date range and a caller-supplied `where` both have to reach Xero's single
// where filter, so they are ANDed rather than one replacing the other.
function combineWhere(...clauses: (string | undefined)[]): string | undefined {
  const present = clauses.filter((clause): clause is string => !!clause);
  if (present.length <= 1) return present[0];
  return present.map((clause) => `(${clause})`).join(" && ");
}

async function getInvoices(
  params: ListInvoicesParams,
): Promise<Invoice[]> {
  await xeroClient.authenticate();

  const {
    page = 1,
    contactIds,
    invoiceNumbers,
    invoiceIds,
    statuses,
    where,
    order = "UpdatedDateUTC DESC",
    fromDate,
    toDate,
  } = params;

  const invoices = await xeroClient.accountingApi.getInvoices(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    combineWhere(formatDocumentDateFilter(fromDate, toDate), where), // where
    order, // order
    invoiceIds, // iDs
    invoiceNumbers, // invoiceNumbers
    contactIds, // contactIDs
    statuses, // statuses
    page,
    false, // includeArchived
    false, // createdByMyApp
    undefined, // unitdp
    false, // summaryOnly
    10, // pageSize
    undefined, // searchTerm
    getClientHeaders(),
  );
  return invoices.body.invoices ?? [];
}

/**
 * List all invoices from Xero
 */
export async function listXeroInvoices(
  params: ListInvoicesParams,
): Promise<XeroClientResponse<Invoice[]>> {
  try {
    const invoices = await getInvoices(params);

    return {
      result: invoices,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
