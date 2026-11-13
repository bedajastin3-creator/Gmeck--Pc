import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  Package,
  Lock,
  X,
  CheckCircle,
  AlertCircle,
  Filter,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProductService } from '../../services/productService';
import { formatCurrency } from '../../utils/formatters';
import { formatPriceInput, parsePriceInput } from '../../utils/priceInput';
import { Product, ProductImage } from '../../types';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { ProductImageViewerModal } from '../common/ProductImageViewerModal';
import { ProductImageUpload } from '../common/ProductImageUpload';

const PAGE_SIZE = 10;

export const SellerProducts: React.FC = () => {
  const { currentUser, dbState, addToast, sellerColor, selectedShopId, currentShop } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditDeniedModal, setShowEditDeniedModal] = useState(false);

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // New Product Form State
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [currentStock, setCurrentStock] = useState('0');
  const [minStock, setMinStock] = useState('5');
  const [unit, setUnit] = useState('pcs');
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Image Viewer Modal State
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const settings = dbState.settings;
  const categories = dbState.categories;

  const targetShopId =
    currentShop?.id ||
    (selectedShopId && selectedShopId !== 'ALL' ? selectedShopId : dbState.shops[0]?.id || '');
  const allCategories = dbState.categories || [];
  const shopCategories = allCategories.filter(c => c.shopId === targetShopId);

  // Filtered Products — search/filter unchanged
  const products = useMemo(() => {
    return ProductService.getProducts({
      shopId: targetShopId,
      categoryId: selectedCategory === 'ALL' ? undefined : selectedCategory,
      search: searchQuery,
      status: 'ACTIVE',
    });
  }, [targetShopId, selectedCategory, searchQuery, dbState.products]);

  // Reset pagination on filter/search change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, selectedCategory, targetShopId]);

  const visibleProducts = products.slice(0, visibleCount);
  const hasMore = products.length > visibleCount;
  const remaining = products.length - visibleCount;

  const handleSeeMore = () => {
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount(prev => prev + PAGE_SIZE);
      setIsLoadingMore(false);
    }, 300);
  };

  const handleSeeLess = () => setVisibleCount(PAGE_SIZE);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSaving(true);

    if (!name.trim()) {
      setFormError('Product name is required.');
      setIsSaving(false);
      return;
    }

    const price = parsePriceInput(sellingPrice);
    if (isNaN(price) || price < 0) {
      setFormError('Please enter a valid selling price.');
      setIsSaving(false);
      return;
    }

    const costPrice = parsePriceInput(purchasePrice) || 0;

    if (!currentUser) {
      setIsSaving(false);
      return;
    }

    const firstActiveCat = shopCategories.find(c => c.status !== 'INACTIVE');

    try {
      const result = await ProductService.createProduct(
        {
          shopId: targetShopId,
          name,
          sku: sku.trim() || undefined,
          barcode: barcode.trim() || undefined,
          categoryId:
            categoryId ||
            firstActiveCat?.id ||
            shopCategories[0]?.id ||
            allCategories[0]?.id ||
            'cat-hardware',
          purchasePrice: costPrice,
          sellingPrice: price,
          currentStock: parseInt(currentStock, 10) || 0,
          minStock: parseInt(minStock, 10) || 5,
          unit,
          images: productImages,
        },
        currentUser
      );

      if (result.success) {
        addToast({
          type: 'success',
          title: 'Product Added',
          description: `'${name}' has been added to catalog and saved locally.`,
        });
        setShowAddModal(false);
        setName('');
        setSku('');
        setBarcode('');
        setPurchasePrice('');
        setSellingPrice('');
        setCurrentStock('0');
        setMinStock('5');
        setProductImages([]);
      } else {
        setFormError(result.error || 'Failed to create product.');
      }
    } catch (error: any) {
      setFormError(error.message || 'An error occurred while saving product.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div id="seller-products-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Product Catalog</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            View active inventory items and add new products to store catalog
          </p>
        </div>

        <button
          id="seller-add-product-btn"
          onClick={() => {
            setCategoryId(shopCategories[0]?.id || '');
            setShowAddModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs text-white shadow-lg transition-all"
          style={{ backgroundColor: sellerColor.primary }}
        >
          <Plus className="w-4 h-4" />
          <span>Add New Product</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-[240px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by product name, SKU, or barcode..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">All Shop Categories</option>
              {shopCategories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-400 font-medium">
          Showing{' '}
          <span className="text-white font-bold">
            {Math.min(visibleCount, products.length)}
          </span>{' '}
          of <span className="text-white font-bold">{products.length}</span> active items
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                <th className="py-3 px-4 font-semibold">Product Name</th>
                <th className="py-3 px-4 font-semibold">SKU / Barcode</th>
                <th className="py-3 px-4 font-semibold">Category</th>
                <th className="py-3 px-4 font-semibold">Stock Level</th>
                <th className="py-3 px-4 font-semibold">Unit</th>
                <th className="py-3 px-4 text-right font-semibold">Selling Price</th>
                <th className="py-3 px-4 text-center font-semibold">Permissions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>No products found.</p>
                  </td>
                </tr>
              ) : (
                visibleProducts.map(product => {
                  const cat = categories.find(c => c.id === product.categoryId);
                  const isLow = product.currentStock <= product.minStock;

                  return (
                    <tr key={product.id} className="hover:bg-slate-850/60 transition">
                      <td className="py-3 px-4 font-semibold text-white">
                        <div className="flex items-center gap-3">
                          <ProductThumbnail
                            product={product}
                            size="md"
                            onClick={() => {
                              setViewingProduct(product);
                              setIsViewerOpen(true);
                            }}
                          />
                          <span className="truncate">{product.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        <div>{product.sku}</div>
                        <div className="text-[10px] text-slate-500">{product.barcode}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-medium border border-slate-700/60">
                          {cat?.name || 'General'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                            product.currentStock <= 0
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : isLow
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                        >
                          {product.currentStock} {product.unit}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">{product.unit}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400 text-sm">
                        {formatCurrency(product.sellingPrice, settings.currencySymbol)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => setShowEditDeniedModal(true)}
                          title="Editing products requires Admin permissions"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-800 text-[11px] text-slate-400 hover:text-amber-300 border border-slate-700 transition"
                        >
                          <Lock className="w-3 h-3 text-slate-500" />
                          <span>Admin Edit</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* See More / See Less Footer */}
        {products.length > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-950/30 flex items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500">
              Showing{' '}
              <span className="text-slate-300 font-semibold">
                {Math.min(visibleCount, products.length)}
              </span>{' '}
              of <span className="text-slate-300 font-semibold">{products.length}</span> products
            </div>
            <div className="flex items-center gap-2">
              {visibleCount > PAGE_SIZE && (
                <button
                  onClick={handleSeeLess}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Show Less
                </button>
              )}
              {hasMore && (
                <button
                  onClick={handleSeeMore}
                  disabled={isLoadingMore}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>
                        See More ({Math.min(PAGE_SIZE, remaining)} of {remaining})
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Seller Adds Product */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Add New Product</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateProduct} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Product Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Bosch Hammer Drill 650W"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Category *</label>
                  <select
                    value={categoryId}
                    onChange={e => setCategoryId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {shopCategories
                      .filter(c => c.status !== 'INACTIVE')
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Unit of Measure *</label>
                  <select
                    value={unit}
                    onChange={e => setUnit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="meter">Meter / Meters (m)</option>
                    <option value="pack">Pack</option>
                    <option value="box">Box</option>
                    <option value="kg">Kilogram (kg)</option>
                    <option value="pair">Pair</option>
                    <option value="roll">Roll</option>
                    <option value="liter">Liter</option>
                    <option value="set">Set</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">SKU (Optional)</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={e => setSku(e.target.value)}
                    placeholder="Auto-generated if empty"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Barcode (Optional)</label>
                  <input
                    type="text"
                    value={barcode}
                    onChange={e => setBarcode(e.target.value)}
                    placeholder="Scan or enter code"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Purchase Price</label>
                  <input
                    type="text"
                    value={purchasePrice}
                    onChange={e => setPurchasePrice(formatPriceInput(e.target.value))}
                    placeholder="0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Proposed Selling Price *
                  </label>
                  <input
                    type="text"
                    required
                    value={sellingPrice}
                    onChange={e => setSellingPrice(formatPriceInput(e.target.value))}
                    placeholder="0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Initial Stock (Defaults to 0)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={currentStock}
                    onChange={e => setCurrentStock(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Min Threshold</label>
                  <input
                    type="number"
                    min="0"
                    value={minStock}
                    onChange={e => setMinStock(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <ProductImageUpload images={productImages} onChange={setProductImages} />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Product to Catalog'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Seller Permission Guard Notice */}
      {showEditDeniedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-3 border border-amber-500/30">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Admin Privilege Required</h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-5">
              Sellers can add new products and process sales, but only <strong>Administrators</strong> can
              modify prices, cost records, and existing product parameters to ensure financial audit integrity.
            </p>
            <button
              onClick={() => setShowEditDeniedModal(false)}
              className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition"
            >
              Understood
            </button>
          </div>
        </div>
      )}

      <ProductImageViewerModal
        product={viewingProduct}
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        currencySymbol={settings.currencySymbol}
      />
    </div>
  );
};
