import React, { useState } from 'react';
import {
  Search,
  Plus,
  Package,
  Edit,
  Power,
  X,
  AlertCircle,
  CheckCircle,
  Store,
  Tag,
  FolderTree,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProductService } from '../../services/productService';
import { CategoryService } from '../../services/categoryService';
import { Product, Category, ProductImage } from '../../types';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { ProductImageViewerModal } from '../common/ProductImageViewerModal';
import { ProductImageUpload } from '../common/ProductImageUpload';

const PAGE_SIZE = 5;

export const AdminProducts: React.FC = () => {
  const { currentUser, dbState, addToast, selectedShopId } = useApp();
  const [activeSubTab, setActiveSubTab] = useState<'products' | 'categories'>('products');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [shopFilter, setShopFilter] = useState('ALL');
  const [categoryShopFilter, setCategoryShopFilter] = useState('ALL');
  const [refreshKey, setRefreshKey] = useState(0);

  // Collapse state for shop groups (default: all expanded)
  const [collapsedShops, setCollapsedShops] = useState<Set<string>>(new Set());

  // Pagination state per shop: { [shopId]: number of items shown }
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [loadingShops, setLoadingShops] = useState<Set<string>>(new Set());

  // Add / Edit Product Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  // Product Form Fields
  const [productShopId, setProductShopId] = useState('');
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

  // Category Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catShopIdInput, setCatShopIdInput] = useState('');
  const [catNameInput, setCatNameInput] = useState('');
  const [catColorInput, setCatColorInput] = useState('#3b82f6');
  const [catModalError, setCatModalError] = useState('');

  if (!currentUser) return null;
  if (
    currentUser.role !== 'ADMIN' &&
    !currentUser.permissions?.canEditProducts &&
    !currentUser.permissions?.canDeleteProducts
  )
    return null;

  const settings = dbState.settings;
  const categories = dbState.categories || [];
  const shops = dbState.shops || [];

  const availableFilterCategories =
    shopFilter === 'ALL' ? categories : categories.filter(c => c.shopId === shopFilter);

  const allProducts = dbState.products || [];

  const products = allProducts.filter(p => {
    if (shopFilter !== 'ALL' && p.shopId !== shopFilter) return false;
    if (categoryFilter !== 'ALL' && p.categoryId !== categoryFilter) return false;
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ==============================
  // GROUP PRODUCTS BY SHOP
  // ==============================
  const groupedByShop = shops
    .map(shop => ({
      shop,
      products: products.filter(p => p.shopId === shop.id),
    }))
    .filter(group => group.products.length > 0);

  const productsWithNoShop = products.filter(p => !shops.some(s => s.id === p.shopId));

  const toggleShopCollapse = (shopId: string) => {
    setCollapsedShops(prev => {
      const next = new Set(prev);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
  };

  // ==============================
  // PAGINATION HELPERS
  // ==============================
  const getVisibleCount = (shopId: string): number => {
    return visibleCounts[shopId] ?? PAGE_SIZE;
  };

  const handleSeeMore = (shopId: string) => {
    // Show loading for a brief moment for a professional feel
    setLoadingShops(prev => new Set(prev).add(shopId));
    setTimeout(() => {
      setVisibleCounts(prev => ({
        ...prev,
        [shopId]: (prev[shopId] ?? PAGE_SIZE) + PAGE_SIZE,
      }));
      setLoadingShops(prev => {
        const next = new Set(prev);
        next.delete(shopId);
        return next;
      });
    }, 300);
  };

  const handleSeeLess = (shopId: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [shopId]: PAGE_SIZE,
    }));
  };

  const openAddModal = () => {
    setEditingProduct(null);
    const initialShopId =
      selectedShopId && selectedShopId !== 'ALL' ? selectedShopId : shops[0]?.id || '';
    setProductShopId(initialShopId);
    setName('');
    setSku('');
    setBarcode('');
    const shopCats = categories.filter(c => c.shopId === initialShopId && c.status !== 'INACTIVE');
    setCategoryId(
      shopCats[0]?.id ||
        categories.find(c => c.status !== 'INACTIVE')?.id ||
        categories[0]?.id ||
        ''
    );
    setPurchasePrice('');
    setSellingPrice('');
    setCurrentStock('0');
    setMinStock('5');
    setUnit('pcs');
    setProductImages([]);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    const pShopId = p.shopId || shops[0]?.id || '';
    setProductShopId(pShopId);
    setName(p.name);
    setSku(p.sku);
    setBarcode(p.barcode);
    setCategoryId(p.categoryId);
    setPurchasePrice(p.purchasePrice.toString());
    setSellingPrice(p.sellingPrice.toString());
    setCurrentStock(p.currentStock.toString());
    setMinStock(p.minStock.toString());
    setUnit(p.unit);
    setProductImages(p.images || []);
    setFormError('');
    setIsModalOpen(true);
  };

  const handleProductShopChange = (newShopId: string) => {
    setProductShopId(newShopId);
    const shopCats = categories.filter(c => c.shopId === newShopId && c.status !== 'INACTIVE');
    if (shopCats.length > 0 && !shopCats.some(c => c.id === categoryId)) {
      setCategoryId(shopCats[0].id);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSaving(true);

    if (!name.trim()) {
      setFormError('Product title is required.');
      setIsSaving(false);
      return;
    }

    if (!productShopId) {
      setFormError('Please select a shop/business unit for this product.');
      setIsSaving(false);
      return;
    }

    const sPrice = parseFloat(sellingPrice) || 0;
    const pPrice = parseFloat(purchasePrice) || 0;

    if (isNaN(sPrice) || sPrice < 0) {
      setFormError('Please enter a valid selling price.');
      setIsSaving(false);
      return;
    }

    try {
      let result;

      if (editingProduct) {
        result = await ProductService.updateProduct(
          editingProduct.id,
          {
            shopId: productShopId,
            name,
            sku: sku.trim(),
            barcode: barcode.trim(),
            categoryId,
            purchasePrice: pPrice,
            sellingPrice: sPrice,
            currentStock: parseInt(currentStock, 10) || 0,
            minStock: parseInt(minStock, 10) || 5,
            unit,
            images: productImages,
          },
          currentUser
        );
      } else {
        result = await ProductService.createProduct(
          {
            shopId: productShopId,
            name,
            sku: sku.trim() || undefined,
            barcode: barcode.trim() || undefined,
            categoryId,
            purchasePrice: pPrice,
            sellingPrice: sPrice,
            currentStock: parseInt(currentStock, 10) || 0,
            minStock: parseInt(minStock, 10) || 5,
            unit,
            images: productImages,
          },
          currentUser
        );
      }

      if (result.success) {
        addToast({
          type: 'success',
          title: editingProduct ? 'Product Updated' : 'Product Created',
          description: editingProduct
            ? `'${name}' details updated.`
            : `'${name}' added to inventory catalog.`,
        });
        setIsModalOpen(false);
        setRefreshKey(prev => prev + 1);
      } else {
        setFormError(result.error || 'Failed to save product.');
      }
    } catch (error: any) {
      console.error('Save product error:', error);
      setFormError(error.message || 'An error occurred while saving product.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (p: Product) => {
    const newStatus = p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = await ProductService.toggleProductStatus(p.id, newStatus, currentUser);
    if (res.success) {
      setRefreshKey(prev => prev + 1);
      addToast({
        type: 'info',
        title: `Product ${newStatus === 'ACTIVE' ? 'Activated' : 'Deactivated'}`,
        description: `'${p.name}' is now ${newStatus}. Preserved in history.`,
      });
    }
  };

  const handleDeleteProduct = () => {
    if (!deletingProduct || !currentUser) return;

    const res = ProductService.deleteProduct(deletingProduct.id, currentUser);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Product Deleted',
        description: `'${deletingProduct.name}' has been permanently deleted.`,
      });
      setRefreshKey(prev => prev + 1);
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete product.',
      });
    }
    setDeletingProduct(null);
  };

  // Category Actions
  const openAddCategoryModal = (targetShopId?: string) => {
    setEditingCategory(null);
    const defaultShop =
      targetShopId ||
      (selectedShopId && selectedShopId !== 'ALL' ? selectedShopId : shops[0]?.id || '');
    setCatShopIdInput(defaultShop);
    setCatNameInput('');
    setCatColorInput('#3b82f6');
    setCatModalError('');
    setIsCategoryModalOpen(true);
  };

  const openEditCategoryModal = (cat: Category) => {
    setEditingCategory(cat);
    setCatShopIdInput(cat.shopId || shops[0]?.id || '');
    setCatNameInput(cat.name);
    setCatColorInput(cat.color || '#3b82f6');
    setCatModalError('');
    setIsCategoryModalOpen(true);
  };

  const handleSaveCategory = (e: React.FormEvent) => {
    e.preventDefault();
    setCatModalError('');

    if (!catNameInput.trim()) {
      setCatModalError('Category name is required.');
      return;
    }

    if (!catShopIdInput) {
      setCatModalError('Please select a specific shop for this category.');
      return;
    }

    if (editingCategory) {
      const res = CategoryService.updateCategory(
        editingCategory.id,
        { name: catNameInput.trim(), shopId: catShopIdInput, color: catColorInput },
        currentUser
      );
      if (res.success) {
        addToast({
          type: 'success',
          title: 'Category Updated',
          description: `Category '${catNameInput}' updated.`,
        });
        setIsCategoryModalOpen(false);
        setRefreshKey(prev => prev + 1);
      } else {
        setCatModalError(res.error || 'Failed to update category.');
      }
    } else {
      const res = CategoryService.createCategory(
        { name: catNameInput.trim(), shopId: catShopIdInput, color: catColorInput },
        currentUser
      );
      if (res.success) {
        addToast({
          type: 'success',
          title: 'Category Created',
          description: `New category '${catNameInput}' created.`,
        });
        setIsCategoryModalOpen(false);
        setRefreshKey(prev => prev + 1);
      } else {
        setCatModalError(res.error || 'Failed to create category.');
      }
    }
  };

  const handleToggleCategoryStatus = (cat: Category) => {
    const res = CategoryService.toggleCategoryStatus(cat.id, currentUser);
    if (res.success) {
      setRefreshKey(prev => prev + 1);
      addToast({
        type: 'info',
        title: 'Category Status Updated',
        description: `Category '${cat.name}' is now ${
          cat.status === 'INACTIVE' ? 'Active' : 'Inactive'
        }.`,
      });
    }
  };

  // ==============================
  // PRODUCT ROW RENDERER
  // ==============================
  const renderProductRow = (product: Product) => {
    const cat = categories.find(c => c.id === product.categoryId);
    const shop = shops.find(s => s.id === product.shopId);
    const isLow = product.currentStock <= product.minStock;
    const proposedPrice = product.proposedSellingPrice || product.sellingPrice;
    const marginPct =
      proposedPrice > 0
        ? (((proposedPrice - product.purchasePrice) / proposedPrice) * 100).toFixed(1)
        : '0';

    return (
      <tr
        key={product.id}
        className={`hover:bg-slate-850/60 transition ${
          product.status === 'INACTIVE' ? 'opacity-50 bg-slate-950/40' : ''
        }`}
      >
        <td className="py-3.5 px-4 font-semibold text-white">
          <div className="flex items-center gap-3">
            <ProductThumbnail
              product={product}
              size="md"
              onClick={() => {
                setViewingProduct(product);
                setIsViewerOpen(true);
              }}
            />
            <div className="min-w-0">
              <div className="truncate font-semibold">{product.name}</div>
              {product.status === 'INACTIVE' && (
                <span className="text-[10px] font-normal text-rose-400 bg-rose-500/10 px-1.5 py-0.2 rounded border border-rose-500/20">
                  Deactivated / Hidden from POS
                </span>
              )}
            </div>
          </div>
        </td>
        <td className="py-3.5 px-4 font-mono text-slate-400">
          <div>{product.sku}</div>
          <div className="text-[10px] text-slate-500">{product.barcode}</div>
        </td>
        <td className="py-3.5 px-4 text-slate-300">
          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-medium border border-slate-700/60">
            {cat?.name || 'General'}
          </span>
        </td>
        <td className="py-3.5 px-4 text-right font-mono text-slate-400">
          {formatCurrency(product.purchasePrice, settings.currencySymbol)}
        </td>
        <td className="py-3.5 px-4 text-right font-mono font-bold text-white">
          {formatCurrency(proposedPrice, settings.currencySymbol)}
        </td>
        <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-semibold">
          {marginPct}%
        </td>
        <td className="py-3.5 px-4 text-center">
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
        <td className="py-3.5 px-4 text-center">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              product.status === 'ACTIVE'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
            }`}
          >
            {product.status}
          </span>
        </td>
        <td className="py-3.5 px-4 text-right space-x-2">
          {(currentUser.role === 'ADMIN' || currentUser.permissions?.canEditProducts) && (
            <>
              <button
                onClick={() => openEditModal(product)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                title="Edit product"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleToggleStatus(product)}
                className={`p-1.5 rounded-lg transition ${
                  product.status === 'ACTIVE'
                    ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400'
                    : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400'
                }`}
                title={product.status === 'ACTIVE' ? 'Deactivate Product' : 'Activate Product'}
              >
                <Power className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {(currentUser.role === 'ADMIN' || currentUser.permissions?.canDeleteProducts) && (
            <button
              onClick={() => setDeletingProduct(product)}
              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition"
              title="Delete product"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div id="admin-products-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Header with Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Products & Category Management
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure catalog pricing, active/deactivated items, and product classification categories
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              onClick={() => setActiveSubTab('products')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                activeSubTab === 'products'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Products Directory</span>
            </button>
            <button
              onClick={() => setActiveSubTab('categories')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                activeSubTab === 'categories'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>Category Management</span>
              <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono">
                {categories.length}
              </span>
            </button>
          </div>

          {activeSubTab === 'products' ? (
            <button
              id="admin-add-product-btn"
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Product</span>
            </button>
          ) : (
            <button
              onClick={openAddCategoryModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Category</span>
            </button>
          )}
        </div>
      </div>

      {activeSubTab === 'products' && (
        <>
          {/* Filter and Search Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 mb-5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3 flex-1 min-w-[260px] flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search product name, SKU, or barcode..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <select
                value={shopFilter}
                onChange={e => setShopFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">All Shops</option>
                {shops.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code || 'UNIT'})
                  </option>
                ))}
              </select>

              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">All Categories</option>
                {availableFilterCategories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>
            </div>

            <div className="text-slate-400 font-medium">
              Total Products: <span className="text-white font-bold">{products.length}</span>
            </div>
          </div>

          {/* GROUPED BY SHOP VIEW */}
          {products.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-16 text-center text-slate-500">
              <Package className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No products match your criteria.</p>
              {shops.length === 0 && (
                <p className="text-xs mt-2 text-slate-400">Create a shop first!</p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {groupedByShop.map(({ shop, products: shopProducts }) => {
                const isCollapsed = collapsedShops.has(shop.id);
                const activeCount = shopProducts.filter(p => p.status === 'ACTIVE').length;
                const lowStockCount = shopProducts.filter(
                  p => p.status === 'ACTIVE' && p.currentStock <= p.minStock
                ).length;

                // Pagination
                const visibleCount = getVisibleCount(shop.id);
                const visibleProducts = shopProducts.slice(0, visibleCount);
                const hasMore = shopProducts.length > visibleCount;
                const remaining = shopProducts.length - visibleCount;
                const isLoading = loadingShops.has(shop.id);

                return (
                  <div
                    key={shop.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg"
                  >
                    {/* Shop Header */}
                    <button
                      onClick={() => toggleShopCollapse(shop.id)}
                      className="w-full flex items-center justify-between gap-3 px-5 py-4 bg-slate-900/80 hover:bg-slate-800/60 active:bg-slate-800 transition border-b border-slate-800"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                          <Store className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-bold text-white truncate">
                              {shop.name}
                            </h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              {shop.code || 'UNIT'}
                            </span>
                            {shop.status === 'INACTIVE' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/20">
                                Shop Inactive
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {shopProducts.length}{' '}
                            {shopProducts.length === 1 ? 'product' : 'products'} •{' '}
                            {activeCount} active
                            {lowStockCount > 0 && (
                              <span className="text-amber-400 ml-1">
                                • {lowStockCount} low stock
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {lowStockCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold border border-amber-500/30">
                            ⚠ {lowStockCount} Low
                          </span>
                        )}
                        {isCollapsed ? (
                          <ChevronRight className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {/* Products Table - Desktop */}
                    {!isCollapsed && (
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                              <th className="py-3 px-4 font-semibold">Product Name</th>
                              <th className="py-3 px-4 font-semibold">SKU / Barcode</th>
                              <th className="py-3 px-4 font-semibold">Category</th>
                              <th className="py-3 px-4 text-right font-semibold">Purchase</th>
                              <th className="py-3 px-4 text-right font-semibold">Selling</th>
                              <th className="py-3 px-4 text-right font-semibold">Margin</th>
                              <th className="py-3 px-4 text-center font-semibold">Stock</th>
                              <th className="py-3 px-4 text-center font-semibold">Status</th>
                              <th className="py-3 px-4 text-right font-semibold">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {visibleProducts.map(renderProductRow)}
                          </tbody>
                        </table>

                        {/* Desktop See More / See Less */}
                        {shopProducts.length > PAGE_SIZE && (
                          <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-950/30 flex items-center justify-between gap-3">
                            <div className="text-[11px] text-slate-500">
                              Showing{' '}
                              <span className="text-slate-300 font-semibold">
                                {Math.min(visibleCount, shopProducts.length)}
                              </span>{' '}
                              of{' '}
                              <span className="text-slate-300 font-semibold">
                                {shopProducts.length}
                              </span>{' '}
                              products
                            </div>
                            <div className="flex items-center gap-2">
                              {visibleCount > PAGE_SIZE && (
                                <button
                                  onClick={() => handleSeeLess(shop.id)}
                                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                                >
                                  Show Less
                                </button>
                              )}
                              {hasMore && (
                                <button
                                  onClick={() => handleSeeMore(shop.id)}
                                  disabled={isLoading}
                                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
                                >
                                  {isLoading ? (
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
                    )}

                    {/* Products Cards - Mobile */}
                    {!isCollapsed && (
                      <div className="md:hidden divide-y divide-slate-800/60">
                        {visibleProducts.map(product => {
                          const cat = categories.find(c => c.id === product.categoryId);
                          const isLow = product.currentStock <= product.minStock;
                          const proposedPrice =
                            product.proposedSellingPrice || product.sellingPrice;
                          const marginPct =
                            proposedPrice > 0
                              ? (
                                  ((proposedPrice - product.purchasePrice) / proposedPrice) *
                                  100
                                ).toFixed(1)
                              : '0';

                          return (
                            <div
                              key={product.id}
                              className={`p-3.5 space-y-2.5 ${
                                product.status === 'INACTIVE' ? 'opacity-55' : ''
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <ProductThumbnail
                                  product={product}
                                  size="md"
                                  onClick={() => {
                                    setViewingProduct(product);
                                    setIsViewerOpen(true);
                                  }}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <h4 className="font-bold text-xs text-white truncate">
                                      {product.name}
                                    </h4>
                                    <span
                                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                                        product.status === 'ACTIVE'
                                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                                      }`}
                                    >
                                      {product.status}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px]">
                                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                                      {cat?.name || 'General'}
                                    </span>
                                    {product.sku && (
                                      <span className="font-mono text-slate-400">
                                        SKU: {product.sku}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-2 text-center text-xs py-1">
                                <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                                  <div className="text-[9px] text-slate-400">Buying</div>
                                  <div className="font-mono text-[11px] text-slate-400">
                                    {formatCurrency(
                                      product.purchasePrice,
                                      settings.currencySymbol
                                    )}
                                  </div>
                                </div>
                                <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                                  <div className="text-[9px] text-slate-400">Selling</div>
                                  <div className="font-mono text-[11px] font-bold text-white">
                                    {formatCurrency(proposedPrice, settings.currencySymbol)}
                                  </div>
                                </div>
                                <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                                  <div className="text-[9px] text-slate-400">Stock</div>
                                  <div
                                    className={`font-mono text-[11px] font-bold ${
                                      product.currentStock <= 0
                                        ? 'text-rose-400'
                                        : isLow
                                        ? 'text-amber-300'
                                        : 'text-emerald-400'
                                    }`}
                                  >
                                    {product.currentStock} {product.unit}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-xs">
                                <div className="text-[11px] text-emerald-400 font-mono">
                                  Margin: <strong>{marginPct}%</strong>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {(currentUser.role === 'ADMIN' ||
                                    currentUser.permissions?.canEditProducts) && (
                                    <>
                                      <button
                                        onClick={() => openEditModal(product)}
                                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 transition"
                                      >
                                        <Edit className="w-3.5 h-3.5" />
                                        <span>Edit</span>
                                      </button>
                                      <button
                                        onClick={() => handleToggleStatus(product)}
                                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                                          product.status === 'ACTIVE'
                                            ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20'
                                            : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                                        }`}
                                      >
                                        <Power className="w-3.5 h-3.5" />
                                        <span>
                                          {product.status === 'ACTIVE' ? 'Off' : 'On'}
                                        </span>
                                      </button>
                                    </>
                                  )}
                                  {(currentUser.role === 'ADMIN' ||
                                    currentUser.permissions?.canDeleteProducts) && (
                                    <button
                                      onClick={() => setDeletingProduct(product)}
                                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition"
                                      title="Delete product"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Mobile See More / See Less */}
                        {shopProducts.length > PAGE_SIZE && (
                          <div className="p-3 bg-slate-950/30 flex items-center justify-between gap-2">
                            <div className="text-[10px] text-slate-500">
                              {Math.min(visibleCount, shopProducts.length)} / {shopProducts.length}
                            </div>
                            <div className="flex items-center gap-2">
                              {visibleCount > PAGE_SIZE && (
                                <button
                                  onClick={() => handleSeeLess(shop.id)}
                                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-[11px] font-semibold"
                                >
                                  Show Less
                                </button>
                              )}
                              {hasMore && (
                                <button
                                  onClick={() => handleSeeMore(shop.id)}
                                  disabled={isLoading}
                                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-semibold disabled:opacity-60"
                                >
                                  {isLoading ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <>
                                      <ChevronDown className="w-3.5 h-3.5" />
                                      <span>See More</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Products without a valid shop */}
              {productsWithNoShop.length > 0 && (
                <div className="bg-slate-900 border border-amber-800/40 rounded-2xl overflow-hidden shadow-lg">
                  <div className="flex items-center gap-3 px-5 py-4 bg-amber-950/20 border-b border-amber-800/40">
                    <AlertCircle className="w-5 h-5 text-amber-400" />
                    <div>
                      <h3 className="text-base font-bold text-white">Unassigned Products</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {productsWithNoShop.length} products have an invalid shop
                      </p>
                    </div>
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                          <th className="py-3 px-4 font-semibold">Product Name</th>
                          <th className="py-3 px-4 font-semibold">SKU / Barcode</th>
                          <th className="py-3 px-4 font-semibold">Category</th>
                          <th className="py-3 px-4 text-right font-semibold">Purchase</th>
                          <th className="py-3 px-4 text-right font-semibold">Selling</th>
                          <th className="py-3 px-4 text-right font-semibold">Margin</th>
                          <th className="py-3 px-4 text-center font-semibold">Stock</th>
                          <th className="py-3 px-4 text-center font-semibold">Status</th>
                          <th className="py-3 px-4 text-right font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {productsWithNoShop.map(renderProductRow)}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Category Management Tab */}
      {activeSubTab === 'categories' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-emerald-400" />
                <span>Shop-Specific Categories</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Every category is assigned to a specific shop to keep products neatly classified
                and isolated.
              </p>
            </div>

            {(currentUser.role === 'ADMIN' || currentUser.permissions?.canEditProducts) && (
              <button
                onClick={() => openAddCategoryModal()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Add Category</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {categories.length === 0 ? (
              <div className="col-span-full p-8 text-center bg-slate-900 border border-slate-800 rounded-xl text-slate-500">
                <FolderTree className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>No categories yet. Create your first category!</p>
              </div>
            ) : (
              categories.map(cat => {
                const shop = shops.find(s => s.id === cat.shopId);
                const isActive = cat.status !== 'INACTIVE';
                const productCount = allProducts.filter(p => p.categoryId === cat.id).length;

                return (
                  <div
                    key={cat.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs"
                          style={{ backgroundColor: cat.color || '#3b82f6' }}
                        >
                          <Tag className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white">{cat.name}</h4>
                          <p className="text-[10px] text-slate-400">
                            {shop?.name || 'No Shop'} • {productCount} Products
                          </p>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isActive
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-rose-500/15 text-rose-400'
                        }`}
                      >
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {(currentUser.role === 'ADMIN' ||
                      currentUser.permissions?.canEditProducts) && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEditCategoryModal(cat)}
                          className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleCategoryStatus(cat)}
                          className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-xs"
                        >
                          Toggle
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Delete Product Confirmation Modal */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-rose-400">
                <Trash2 className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Delete Product?</h3>
              </div>
              <button
                onClick={() => setDeletingProduct(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-200 text-xs mb-4">
              <strong>Warning:</strong> This action is permanent and cannot be undone.
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Are you sure you want to delete{' '}
              <strong className="text-white">{deletingProduct.name}</strong>?
              <br />
              <br />
              This will permanently remove the product from all shops and delete its images.
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProduct}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition"
              >
                Delete Product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  {editingProduct ? 'Edit Product Details' : 'Create New Product'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
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

            <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Assigned Shop / Unit *
                </label>
                <select
                  value={productShopId}
                  onChange={e => handleProductShopChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select shop...</option>
                  {shops.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code || 'UNIT'})
                    </option>
                  ))}
                </select>
                {shops.length === 0 && (
                  <p className="text-[10px] text-rose-400 mt-1">
                    No shops available. Create a shop first!
                  </p>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Product Title *</label>
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
                  <label className="block text-slate-300 font-medium mb-1">
                    Purchasing Price
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={purchasePrice}
                    onChange={e => setPurchasePrice(e.target.value)}
                    placeholder="0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Selling Price *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={sellingPrice}
                    onChange={e => setSellingPrice(e.target.value)}
                    placeholder="0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    {editingProduct ? 'Current Stock Level' : 'Initial Stock'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={currentStock}
                    onChange={e => setCurrentStock(e.target.value)}
                    placeholder="0"
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
                    placeholder="5"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-slate-300 font-medium">Category *</label>
                    {(currentUser.role === 'ADMIN' ||
                      currentUser.permissions?.canEditProducts) && (
                      <button
                        type="button"
                        onClick={() => openAddCategoryModal(productShopId)}
                        className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                      >
                        <Plus className="w-3 h-3" />
                        <span>New</span>
                      </button>
                    )}
                  </div>
                  <select
                    value={categoryId}
                    onChange={e => setCategoryId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select category...</option>
                    {categories
                      .filter(
                        c =>
                          c.shopId === productShopId &&
                          (c.status !== 'INACTIVE' || c.id === categoryId)
                      )
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.status === 'INACTIVE' ? '(Inactive)' : ''}
                        </option>
                      ))}
                  </select>
                  {categories.filter(c => c.shopId === productShopId).length === 0 && (
                    <p className="text-[10px] text-amber-400 mt-1">
                      No categories exist for this shop yet. Click "+ New" above.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Unit of Measure *
                  </label>
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
                  <label className="block text-slate-300 font-medium mb-1">SKU / Code</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={e => setSku(e.target.value)}
                    placeholder="Auto-generated if empty"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Barcode</label>
                  <input
                    type="text"
                    value={barcode}
                    onChange={e => setBarcode(e.target.value)}
                    placeholder="Scan or enter code"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <ProductImageUpload
                  images={productImages}
                  onChange={setProductImages}
                  productId={editingProduct?.id}
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || shops.length === 0}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition disabled:opacity-50"
                >
                  {isSaving
                    ? 'Saving...'
                    : editingProduct
                    ? 'Save Changes'
                    : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Category Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white">
                {editingCategory ? 'Edit Category' : 'Create Category'}
              </h3>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {catModalError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                {catModalError}
              </div>
            )}

            <form onSubmit={handleSaveCategory} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Shop *</label>
                <select
                  value={catShopIdInput}
                  onChange={e => setCatShopIdInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                >
                  <option value="">Select shop...</option>
                  {shops.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Category Name *
                </label>
                <input
                  type="text"
                  required
                  value={catNameInput}
                  onChange={e => setCatNameInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Color</label>
                <div className="flex gap-2">
                  {['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'].map(
                    color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setCatColorInput(color)}
                        className={`w-7 h-7 rounded-full ${
                          catColorInput === color ? 'ring-2 ring-white' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    )
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs"
                >
                  {editingCategory ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
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
