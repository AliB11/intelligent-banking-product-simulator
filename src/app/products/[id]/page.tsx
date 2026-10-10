import { notFound } from "next/navigation";
import { productId as parseId } from "@/lib/api";
import Lab from "@/components/Lab";
import { getProduct, latestAlmResult, latestFullResult, listSimulations } from "@/db/repo";

export const dynamic = "force-dynamic";

export default async function ProductLabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let parsed: number;
  try { parsed = parseId(id); } catch { notFound(); }
  const product = await getProduct(parsed);
  if (!product) notFound();
  const [initial, history, almLatest] = await Promise.all([
    latestFullResult(product.id, product.configVersion),
    listSimulations(product.id),
    product.config.kind === "points_loan" ? latestAlmResult(product.id, product.configVersion) : Promise.resolve(null),
  ]);
  return <Lab key={`${product.id}-${product.configVersion}`} productId={product.id} config={product.config} configVersion={product.configVersion} initial={initial} history={history} almLatest={almLatest} />;
}
