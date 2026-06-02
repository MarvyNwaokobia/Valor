// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title ValorItems — ERC1155 NFT contract for all in-game items
contract ValorItems is ERC1155, Ownable {
    using Strings for uint256;

    string public name = "Valor Items";
    string public symbol = "VITEM";

    // Only the marketplace contract can mint items
    address public marketplace;

    // item id => max supply (0 = unlimited)
    mapping(uint256 => uint256) public maxSupply;
    // item id => total minted
    mapping(uint256 => uint256) public totalMinted;
    // item id => metadata URI
    mapping(uint256 => string) private _itemUris;

    event MarketplaceSet(address indexed marketplace);
    event ItemRegistered(uint256 indexed itemId, uint256 maxSupply);

    error OnlyMarketplace();
    error ItemNotRegistered();
    error MaxSupplyReached();

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert OnlyMarketplace();
        _;
    }

    constructor(address _owner) ERC1155("") Ownable(_owner) {}

    function setMarketplace(address _marketplace) external onlyOwner {
        marketplace = _marketplace;
        emit MarketplaceSet(_marketplace);
    }

    function registerItem(uint256 itemId, uint256 _maxSupply, string calldata metadataUri)
        external
        onlyOwner
    {
        maxSupply[itemId] = _maxSupply;
        _itemUris[itemId] = metadataUri;
        emit ItemRegistered(itemId, _maxSupply);
    }

    function mint(address to, uint256 itemId, uint256 amount) external onlyMarketplace {
        uint256 max = maxSupply[itemId];
        if (max > 0 && totalMinted[itemId] + amount > max) revert MaxSupplyReached();
        totalMinted[itemId] += amount;
        _mint(to, itemId, amount, "");
    }

    function uri(uint256 itemId) public view override returns (string memory) {
        string memory itemUri = _itemUris[itemId];
        return bytes(itemUri).length > 0 ? itemUri : super.uri(itemId);
    }

    function remainingSupply(uint256 itemId) external view returns (uint256) {
        uint256 max = maxSupply[itemId];
        if (max == 0) return type(uint256).max;
        return max - totalMinted[itemId];
    }
}
