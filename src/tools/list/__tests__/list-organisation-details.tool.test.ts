import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentTermType } from "xero-node/dist/gen/model/accounting/paymentTermType.js";

vi.mock("../../../handlers/list-xero-organisation-details.handler.js", () => ({
  listXeroOrganisationDetails: vi.fn(),
}));

import { listXeroOrganisationDetails } from "../../../handlers/list-xero-organisation-details.handler.js";
import ListOrganisationDetailsTool from "../list-organisation-details.tool.js";

const listOrganisationDetails = vi.mocked(listXeroOrganisationDetails);

describe("list-organisation-details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOrganisationDetails.mockResolvedValue({
      result: {},
      isError: false,
      error: null,
    } as never);
  });

  it("uses fallback text instead of rendering undefined values literally", async () => {
    const response = await ListOrganisationDetailsTool().handler(
      {} as never,
      {} as never,
    );
    const content = response.content as Array<{ text: string }>;

    expect(content[1].text).toContain("Name: No name available.");
    expect(content[1].text).toContain(
      "Organisation ID: No organisation ID available.",
    );
    expect(content[1].text).toContain(
      "Financial Year End Day: No financial year end day set.",
    );
    expect(content[1].text).toContain("External Links:\nNo external links available.");
    expect(content[1].text).not.toContain("undefined ||");
  });

  it("renders nested bill and sales payment terms", async () => {
    listOrganisationDetails.mockResolvedValue({
      result: {
        paymentTerms: {
          bills: { day: 20, type: PaymentTermType.DAYSAFTERBILLDATE },
          sales: { day: 10, type: PaymentTermType.OFCURRENTMONTH },
        },
      },
      isError: false,
      error: null,
    } as never);

    const response = await ListOrganisationDetailsTool().handler(
      {} as never,
      {} as never,
    );
    const content = response.content as Array<{ text: string }>;

    expect(content[1].text).toContain(
      "Payment Terms:\nBills: Day: 20, Type: DAYSAFTERBILLDATE\nSales: Day: 10, Type: OFCURRENTMONTH",
    );
    expect(content[1].text).not.toContain("[object Object]");
  });
});
